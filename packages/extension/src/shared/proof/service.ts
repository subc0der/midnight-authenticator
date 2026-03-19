/**
 * Proof Service Manager
 *
 * Coordinates proof generation across multiple providers with automatic fallback:
 * 1. LaceProofProvider - Try Lace wallet first (future-ready)
 * 2. HttpProofProvider - Fall back to local Docker proof server
 * 3. MockProofProvider - Last resort for development only
 *
 * The service automatically selects the best available provider
 * and handles errors gracefully with clear user feedback.
 */

import type {
  ProofProvider,
  ProofRequest,
  ProofResult,
  ProofServiceConfig,
  ProofServiceStatus,
} from './types.js';
import { LaceProofProvider } from './lace-provider.js';
import { HttpProofProvider } from './http-provider.js';
import { MockProofProvider } from './mock-provider.js';

/** Default configuration */
const DEFAULT_CONFIG: Required<ProofServiceConfig> = {
  proofServerUrl: 'http://localhost:6300',
  timeoutMs: 60_000,
  allowMockProofs: true, // Controlled by isDevelopment() in mock provider
  preferredProvider: null,
};

/** Storage key for provider preference */
const PROVIDER_PREFERENCE_KEY = 'preferredProofProvider';

/**
 * Load the preferred provider from storage.
 */
async function loadProviderPreference(): Promise<string | null> {
  try {
    const { [PROVIDER_PREFERENCE_KEY]: provider = null } = await chrome.storage.local.get(PROVIDER_PREFERENCE_KEY);
    return provider;
  } catch {
    return null;
  }
}

/**
 * Check if the extension is running in development mode.
 */
function isDevelopment(): boolean {
  try {
    const manifest = chrome.runtime.getManifest();
    return !('update_url' in manifest);
  } catch {
    return true;
  }
}

/**
 * Proof service that manages multiple proof providers with fallback.
 */
export class ProofService {
  private providers: ProofProvider[];
  private config: Required<ProofServiceConfig>;

  constructor(config: ProofServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize providers in priority order
    this.providers = [
      new LaceProofProvider(),
      new HttpProofProvider(this.config.proofServerUrl),
    ];

    // Only add mock provider in development
    if (this.config.allowMockProofs) {
      this.providers.push(new MockProofProvider());
    }
  }

  /**
   * Generate a proof using the first available provider.
   * Respects user's preferred provider if set (dev mode feature).
   */
  async generateProof(request: ProofRequest): Promise<ProofResult> {
    // Check for preferred provider (dev mode feature)
    const preferred = await loadProviderPreference();

    if (preferred) {
      const preferredProvider = this.providers.find(p => p.name === preferred);
      if (preferredProvider) {
        const available = await preferredProvider.isAvailable();
        if (available) {
          console.log(`[ProofService] Using preferred provider: ${preferredProvider.name}`);
          return this.generateWithTimeout(preferredProvider, request);
        } else {
          console.log(`[ProofService] Preferred provider ${preferred} not available, falling back`);
        }
      }
    }

    // Find first available provider (fallback chain)
    for (const provider of this.providers) {
      const available = await provider.isAvailable();
      if (available) {
        console.log(`[ProofService] Using provider: ${provider.name}`);
        return this.generateWithTimeout(provider, request);
      }
    }

    // No provider available
    return {
      success: false,
      error: this.getNoProviderErrorMessage(),
      providerName: 'none',
    };
  }

  /**
   * Generate proof with timeout wrapper.
   */
  private async generateWithTimeout(
    provider: ProofProvider,
    request: ProofRequest,
  ): Promise<ProofResult> {
    const timeoutPromise = new Promise<ProofResult>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          error: `Proof generation timed out after ${this.config.timeoutMs / 1000} seconds`,
          providerName: provider.name,
        });
      }, this.config.timeoutMs);
    });

    try {
      return await Promise.race([
        provider.generateAuthProof(request),
        timeoutPromise,
      ]);
    } catch (error) {
      return {
        success: false,
        error: `Proof generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        providerName: provider.name,
      };
    }
  }

  /**
   * Get the name of the first available provider.
   */
  async getAvailableProvider(): Promise<string | null> {
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        return provider.name;
      }
    }
    return null;
  }

  /**
   * Get detailed status of all providers.
   */
  async getStatus(): Promise<ProofServiceStatus> {
    // Check Lace detection (not usability - that requires prover URI)
    const laceProvider = this.providers[0] as LaceProofProvider;
    const laceDetected = await laceProvider?.isDetected?.() ?? false;

    // Check which providers are available for actual use
    const [laceUsable, mockAvailable] = await Promise.all([
      this.providers[0]?.isAvailable() ?? false,
      this.providers[2]?.isAvailable() ?? false,
    ]);

    // Check proof server connectivity separately (for status display)
    const httpProvider = this.providers[1] as HttpProofProvider;
    const proofServerAvailable = await httpProvider?.canConnectToServer() ?? false;

    // Determine active provider (what would actually be used for proofs)
    let activeProvider: string | null = null;
    if (laceUsable) activeProvider = 'lace';
    else if (mockAvailable) activeProvider = 'mock';
    // Note: HTTP not included until SDK integration is complete

    return {
      activeProvider,
      laceAvailable: laceDetected, // Show if Lace is detected, not if usable
      proofServerAvailable,
      mockEnabled: isDevelopment() && this.config.allowMockProofs,
    };
  }

  /**
   * Get a user-friendly error message when no provider is available.
   */
  private getNoProviderErrorMessage(): string {
    if (isDevelopment()) {
      return (
        'No proof provider available. Options:\n' +
        '1. Install Lace wallet with Midnight enabled\n' +
        '2. Start proof server: docker start proof-server\n' +
        '3. Mock provider should be available in development'
      );
    }
    return (
      'No proof provider available. Please either:\n' +
      '1. Install and configure Lace wallet for Midnight\n' +
      '2. Run proof server: docker run -d --name proof-server -p 6300:6300 midnightntwrk/proof-server:7.0.0 midnight-proof-server -v'
    );
  }

  /**
   * Get user-friendly provider description.
   */
  getProviderDescription(providerName: string): string {
    switch (providerName) {
      case 'lace':
        return 'Lace Wallet';
      case 'http':
        return 'Local Proof Server (Docker)';
      case 'mock':
        return 'Mock (Development Only)';
      default:
        return providerName;
    }
  }
}

// Singleton instance
let proofServiceInstance: ProofService | null = null;

/**
 * Get the proof service singleton.
 */
export function getProofService(config?: ProofServiceConfig): ProofService {
  if (!proofServiceInstance) {
    proofServiceInstance = new ProofService(config);
  }
  return proofServiceInstance;
}

/**
 * Reset the proof service singleton (for testing).
 */
export function resetProofService(): void {
  proofServiceInstance = null;
}
