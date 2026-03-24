/**
 * HTTP Proof Provider
 *
 * Connects to a local Docker proof server for real ZK proof generation.
 * The proof server must be running at the configured URL (default: localhost:6300).
 *
 * Start the proof server with:
 *   docker run -d --name proof-server -p 6300:6300 \
 *     midnightntwrk/proof-server:7.0.0 midnight-proof-server -v
 */

import type { ProofProvider, ProofRequest, ProofResult } from './types.js';

/** Default proof server URL */
const DEFAULT_PROOF_SERVER_URL = 'http://localhost:6300';

/** Timeout for proof generation (60 seconds) */
const PROOF_TIMEOUT_MS = 60_000;

/** Timeout for health check (5 seconds) */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * HTTP-based proof provider that connects to the local Docker proof server.
 *
 * This provider requires:
 * 1. Docker proof server running at localhost:6300
 * 2. ZK circuit files available to the proof server
 *
 * The actual proof generation uses the Midnight SDK's proof protocol.
 * This is a simplified implementation that will be enhanced when
 * integrating with the full Midnight SDK for browser.
 */
export class HttpProofProvider implements ProofProvider {
  readonly name = 'http';
  private readonly proofServerUrl: string;

  constructor(proofServerUrl: string = DEFAULT_PROOF_SERVER_URL) {
    this.proofServerUrl = proofServerUrl;
  }

  /**
   * Check if the proof server is reachable AND SDK integration is complete.
   *
   * Currently returns false because real SDK integration is pending.
   * The proof server may be running, but we can't use it without the SDK.
   */
  async isAvailable(): Promise<boolean> {
    // TODO: Return true once SDK integration is complete
    // For now, always return false to fall back to mock provider
    // The proof server connectivity can be checked via canConnectToServer()
    return false;
  }

  /**
   * Check if the proof server is reachable (for status display).
   * This is separate from isAvailable() because we want to show
   * the server status even if we can't use it yet.
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
   *
   * NOTE: This is a placeholder implementation. Full proof generation
   * requires integration with the Midnight SDK's circuit calling mechanism.
   * The SDK handles:
   * - Building the circuit call with inputs
   * - Formatting the proof request
   * - Sending to proof server
   * - Parsing the proof response
   *
   * For now, this returns an error indicating real proofs need SDK integration.
   * The mock provider can be used for development in the meantime.
   */
  async generateAuthProof(request: ProofRequest): Promise<ProofResult> {
    // First check if proof server is available
    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        error: 'Proof server not available. Please ensure Docker is running with: docker start proof-server',
        providerName: this.name,
      };
    }

    // Validate inputs
    const validationError = this.validateRequest(request);
    if (validationError) {
      return {
        success: false,
        error: validationError,
        providerName: this.name,
      };
    }

    // TODO: Integrate with Midnight SDK for real proof generation
    //
    // The flow will be:
    // 1. Import contract and circuit definitions
    // 2. Create circuit context with witness functions
    // 3. Call authenticate() circuit with inputs
    // 4. SDK sends proof request to proof server
    // 5. Return proof bytes
    //
    // This requires:
    // - @midnight-ntwrk/midnight-js-contracts
    // - @midnight-ntwrk/midnight-js-http-client-proof-provider
    // - Browser-compatible ZK config provider
    // - Compiled contract assets bundled with extension

    // For now, return an error indicating SDK integration is needed
    return {
      success: false,
      error:
        'Real proof generation requires Midnight SDK integration. ' +
        'Use mock provider for development, or check back after SDK dependencies are added.',
      providerName: this.name,
    };
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
 * Create an HTTP proof provider with the given URL.
 */
export function createHttpProofProvider(proofServerUrl?: string): HttpProofProvider {
  return new HttpProofProvider(proofServerUrl);
}
