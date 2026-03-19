/**
 * Lace Proof Provider
 *
 * Integrates with the Lace wallet for proof generation.
 * Lace manages the proof server configuration and can provide
 * the prover service URI, which may be local or remote.
 *
 * This provider:
 * 1. Detects if Lace wallet is available (via content script)
 * 2. Gets the proof server URI from Lace's serviceUriConfig()
 * 3. Uses that proof server for proof generation
 *
 * At mainnet, Lace may provide remote proof server URIs,
 * eliminating the need for users to run Docker locally.
 *
 * NOTE: Lace detection must be done via content script messaging
 * because the background service worker cannot access window.midnight.
 */

import type { ProofProvider, ProofRequest, ProofResult } from './types.js';
import { HttpProofProvider } from './http-provider.js';

/** Cached Lace status to avoid repeated tab queries */
interface LaceStatus {
  available: boolean;
  proverUri?: string;
  checkedAt: number;
}

// Cache Lace status for 30 seconds
const LACE_CACHE_TTL_MS = 30_000;
let cachedLaceStatus: LaceStatus | null = null;

/**
 * Query the active tab's content script to check if Lace is available.
 * This is needed because background service workers can't access window.midnight.
 */
async function queryLaceFromContentScript(): Promise<LaceStatus> {
  // Return cached status if still valid
  if (cachedLaceStatus && Date.now() - cachedLaceStatus.checkedAt < LACE_CACHE_TTL_MS) {
    return cachedLaceStatus;
  }

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      return { available: false, checkedAt: Date.now() };
    }

    // Don't query chrome:// or extension pages
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return { available: false, checkedAt: Date.now() };
    }

    // Query the content script
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'CHECK_LACE_AVAILABLE' });

    cachedLaceStatus = {
      available: response?.laceAvailable ?? false,
      proverUri: response?.proverUri,
      checkedAt: Date.now(),
    };

    return cachedLaceStatus;
  } catch {
    // Content script not available or tab doesn't support messaging
    return { available: false, checkedAt: Date.now() };
  }
}

/**
 * Invalidate the Lace status cache (call when user switches tabs, etc.)
 */
export function invalidateLaceCache(): void {
  cachedLaceStatus = null;
}

/**
 * Lace wallet provider that integrates with the Lace browser extension.
 *
 * When Lace is available, this provider:
 * - Gets the proof server URI from Lace's configuration
 * - Uses that URI for proof generation (via HttpProofProvider)
 *
 * This enables future compatibility where Lace might provide
 * remote proof servers at mainnet, eliminating Docker requirements.
 */
export class LaceProofProvider implements ProofProvider {
  readonly name = 'lace';
  private httpProvider: HttpProofProvider | null = null;

  /**
   * Check if Lace wallet is available.
   * Queries the active tab's content script since we can't access window directly.
   */
  async isAvailable(): Promise<boolean> {
    const status = await queryLaceFromContentScript();
    if (!status.available || !status.proverUri) {
      return false;
    }

    // Verify the proof server is reachable
    this.httpProvider = new HttpProofProvider(status.proverUri);
    return await this.httpProvider.isAvailable();
  }

  /**
   * Generate a proof using Lace's configured proof server.
   */
  async generateAuthProof(request: ProofRequest): Promise<ProofResult> {
    const status = await queryLaceFromContentScript();

    if (!status.available) {
      return {
        success: false,
        error: 'Lace wallet not detected. Please install Lace and enable Midnight features.',
        providerName: this.name,
      };
    }

    if (!status.proverUri) {
      return {
        success: false,
        error: 'Lace wallet does not have a proof server configured.',
        providerName: this.name,
      };
    }

    // Create HTTP provider with Lace's proof server URL
    this.httpProvider = new HttpProofProvider(status.proverUri);

    // Delegate to HTTP provider
    const result = await this.httpProvider.generateAuthProof(request);

    // Mark result as coming from Lace
    return {
      ...result,
      providerName: this.name,
    };
  }

  /**
   * Get information about Lace's configuration.
   */
  async getLaceInfo(): Promise<{
    available: boolean;
    proverUri?: string;
  }> {
    const status = await queryLaceFromContentScript();
    return {
      available: status.available,
      proverUri: status.proverUri,
    };
  }

  /**
   * Check if Lace wallet is detected (regardless of prover availability).
   * Use this for status display, not for proof generation.
   */
  async isDetected(): Promise<boolean> {
    const status = await queryLaceFromContentScript();
    return status.available;
  }
}

/**
 * Check if Lace wallet is installed and available.
 * Uses cached status if available, otherwise queries content script.
 */
export async function isLaceAvailable(): Promise<boolean> {
  const status = await queryLaceFromContentScript();
  return status.available;
}

/**
 * Create a Lace proof provider.
 */
export function createLaceProofProvider(): LaceProofProvider {
  return new LaceProofProvider();
}
