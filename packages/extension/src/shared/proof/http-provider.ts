/**
 * HTTP Proof Provider
 *
 * Connects to a local Docker proof server for real ZK proof generation.
 * Delegates actual proof generation to the offscreen document which has
 * DOM access required by the Midnight SDK.
 *
 * The proof server must be running at the configured URL (default: localhost:6300).
 *
 * Start the proof server with:
 *   docker run -d --name proof-server -p 6300:6300 \
 *     midnightntwrk/proof-server:7.0.0 midnight-proof-server -v
 *
 * For development, also start the demo app to serve circuit files:
 *   cd apps/demo && pnpm dev
 */

import type {
  ProofProvider,
  ProofRequest,
  ProofResult,
  ServiceUris,
  GenerateAuthProofMessage,
  GenerateAuthProofResponse,
  CheckProofAvailabilityMessage,
  CheckProofAvailabilityResponse,
} from './types.js';

/** Default proof server URL */
const DEFAULT_PROOF_SERVER_URL = 'http://localhost:6300';

/** Default circuit assets URL (demo app) */
const DEFAULT_CIRCUIT_ASSETS_URL = 'http://localhost:3000/circuits/totp-verifier/';

/** Timeout for proof generation (120 seconds - proofs can be slow) */
const PROOF_TIMEOUT_MS = 120_000;

/** Timeout for health check (5 seconds) */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/** Track if offscreen document is created */
let offscreenCreated = false;

/**
 * Ensure the offscreen document exists for proof generation.
 * The offscreen document has DOM access required by the Midnight SDK.
 */
async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreated) {
    return;
  }

  // Check if already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }

  // Create offscreen document
  console.log('[HttpProofProvider] Creating offscreen document for proof generation');
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Midnight SDK requires DOM access for ZK proof generation',
  });

  // Wait for it to be ready
  await new Promise((resolve) => setTimeout(resolve, 100));
  offscreenCreated = true;
}

/**
 * HTTP-based proof provider that connects to the local Docker proof server.
 *
 * This provider requires:
 * 1. Docker proof server running at localhost:6300
 * 2. Circuit assets served via HTTP (demo app at localhost:3000)
 *
 * Proof generation is delegated to the offscreen document which has
 * DOM access required by the Midnight SDK.
 */
export class HttpProofProvider implements ProofProvider {
  readonly name = 'http';
  private readonly proofServerUrl: string;
  private readonly circuitAssetsUrl: string;
  private availabilityChecked = false;
  private cachedAvailability = false;

  constructor(
    proofServerUrl: string = DEFAULT_PROOF_SERVER_URL,
    circuitAssetsUrl: string = DEFAULT_CIRCUIT_ASSETS_URL
  ) {
    this.proofServerUrl = proofServerUrl;
    this.circuitAssetsUrl = circuitAssetsUrl;
  }

  /**
   * Get service URIs for the offscreen document.
   */
  private getServiceUris(): ServiceUris {
    return {
      proverServerUri: this.proofServerUrl,
      circuitAssetsUrl: this.circuitAssetsUrl,
    };
  }

  /**
   * Check if real proof generation is available.
   * Delegates to offscreen document to verify:
   * 1. Proof server is reachable
   * 2. Circuit assets are accessible
   */
  async isAvailable(): Promise<boolean> {
    // Use cached result if recently checked (within 30 seconds)
    if (this.availabilityChecked) {
      return this.cachedAvailability;
    }

    try {
      await ensureOffscreenDocument();

      const response = await Promise.race([
        chrome.runtime.sendMessage({
          type: 'CHECK_PROOF_AVAILABILITY',
          serviceUris: this.getServiceUris(),
        } as CheckProofAvailabilityMessage),
        new Promise<CheckProofAvailabilityResponse>((_, reject) =>
          setTimeout(() => reject(new Error('Availability check timeout')), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ]) as CheckProofAvailabilityResponse;

      this.cachedAvailability = response?.available ?? false;
      this.availabilityChecked = true;

      // Reset cache after 30 seconds
      setTimeout(() => {
        this.availabilityChecked = false;
      }, 30_000);

      console.log('[HttpProofProvider] Availability check:', this.cachedAvailability);
      return this.cachedAvailability;
    } catch (error) {
      console.warn('[HttpProofProvider] Availability check failed:', error);
      this.cachedAvailability = false;
      this.availabilityChecked = true;
      return false;
    }
  }

  /**
   * Check if the proof server is reachable (for status display).
   * This is a direct health check, not through offscreen.
   */
  async canConnectToServer(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(`${this.proofServerUrl}/version`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Generate an authentication proof using the proof server.
   * Delegates to the offscreen document which runs the Midnight SDK.
   */
  async generateAuthProof(request: ProofRequest): Promise<ProofResult> {
    // Validate inputs first
    const validationError = this.validateRequest(request);
    if (validationError) {
      return {
        success: false,
        error: validationError,
        providerName: this.name,
      };
    }

    try {
      await ensureOffscreenDocument();

      console.log('[HttpProofProvider] Generating proof via offscreen document...');

      // Build message for offscreen document
      // Convert Uint8Array to number[] and bigint to string for message passing
      const message: GenerateAuthProofMessage = {
        type: 'GENERATE_AUTH_PROOF',
        serviceUris: this.getServiceUris(),
        accountId: Array.from(request.accountId),
        nonce: request.nonce.toString(),
        expectedTimeWindow: request.expectedTimeWindow.toString(),
        secret: Array.from(request.secret),
        blinder: Array.from(request.blinder),
      };

      // Send to offscreen document with timeout
      const response = await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise<GenerateAuthProofResponse>((_, reject) =>
          setTimeout(() => reject(new Error('Proof generation timeout')), PROOF_TIMEOUT_MS)
        ),
      ]) as GenerateAuthProofResponse;

      if (!response) {
        return {
          success: false,
          error: 'No response from offscreen document',
          providerName: this.name,
        };
      }

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Proof generation failed',
          providerName: this.name,
        };
      }

      console.log('[HttpProofProvider] Proof generated successfully');

      return {
        success: true,
        proof: response.proof ? new Uint8Array(response.proof) : undefined,
        publicInputs: {
          accountId: request.accountId,
          nonce: request.nonce,
          expectedTimeWindow: request.expectedTimeWindow,
          result: response.isVerified ?? true,
        },
        providerName: this.name,
        isMock: response.isMock,
      };
    } catch (error) {
      console.error('[HttpProofProvider] Proof generation error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        providerName: this.name,
      };
    }
  }

  /**
   * Get the proof server version.
   */
  async getServerVersion(): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(`${this.proofServerUrl}/version`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.version || data.Version || JSON.stringify(data);
    } catch {
      return null;
    }
  }

  /**
   * Validate the proof request inputs.
   */
  private validateRequest(request: ProofRequest): string | null {
    if (!request.accountId || request.accountId.length !== 32) {
      return 'Invalid accountId: must be 32 bytes';
    }
    if (!request.secret || request.secret.length !== 32) {
      return 'Invalid secret: must be 32 bytes';
    }
    if (!request.blinder || request.blinder.length !== 32) {
      return 'Invalid blinder: must be 32 bytes';
    }
    if (typeof request.nonce !== 'bigint' || request.nonce < 0n) {
      return 'Invalid nonce: must be non-negative bigint';
    }
    if (typeof request.expectedTimeWindow !== 'bigint' || request.expectedTimeWindow < 0n) {
      return 'Invalid expectedTimeWindow: must be non-negative bigint';
    }
    return null;
  }
}

/**
 * Create an HTTP proof provider with the given URLs.
 */
export function createHttpProofProvider(
  proofServerUrl?: string,
  circuitAssetsUrl?: string
): HttpProofProvider {
  return new HttpProofProvider(proofServerUrl, circuitAssetsUrl);
}
