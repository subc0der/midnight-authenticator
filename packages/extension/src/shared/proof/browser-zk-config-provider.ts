/**
 * Browser-compatible ZK Config Provider
 *
 * Loads circuit assets bundled with the extension via fetch().
 * This replaces NodeZkConfigProvider which requires Node.js filesystem access.
 *
 * Circuit assets are copied from contracts package to extension dist/circuits/
 * during the build process (see vite.config.ts).
 */

import {
  ZKConfigProvider,
  type ZKIR,
  type ProverKey,
  type VerifierKey,
} from '@midnight-ntwrk/midnight-js-types';

export class BrowserZkConfigProvider extends ZKConfigProvider<string> {
  private readonly basePath: string;
  private readonly cache = new Map<string, Uint8Array>();

  /**
   * Create a browser ZK config provider.
   * @param circuitName - Name of the circuit directory (e.g., 'totp-verifier')
   */
  constructor(circuitName: string) {
    super();
    this.basePath = `circuits/${circuitName}`;
  }

  /**
   * Load ZKIR (zero-knowledge intermediate representation) for a circuit.
   */
  async getZKIR(circuitId: string): Promise<ZKIR> {
    const bytes = await this.loadAsset(`zkir/${circuitId}.zkir`);
    return bytes as ZKIR;
  }

  /**
   * Load the prover key for a circuit.
   */
  async getProverKey(circuitId: string): Promise<ProverKey> {
    const bytes = await this.loadAsset(`keys/${circuitId}.prover`);
    return bytes as ProverKey;
  }

  /**
   * Load the verifier key for a circuit.
   */
  async getVerifierKey(circuitId: string): Promise<VerifierKey> {
    const bytes = await this.loadAsset(`keys/${circuitId}.verifier`);
    return bytes as VerifierKey;
  }

  /**
   * Load a circuit asset file.
   * Uses chrome.runtime.getURL to access bundled extension resources.
   */
  private async loadAsset(relativePath: string): Promise<Uint8Array> {
    const fullPath = `${this.basePath}/${relativePath}`;

    // Return cached asset if available
    const cached = this.cache.get(fullPath);
    if (cached) {
      return cached;
    }

    // Build the extension resource URL
    const url = chrome.runtime.getURL(fullPath);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Cache for future use
      this.cache.set(fullPath, bytes);

      return bytes;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load circuit asset '${fullPath}': ${message}`);
    }
  }

  /**
   * Clear the asset cache.
   * Call this if you need to free memory.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the total size of cached assets in bytes.
   */
  getCacheSize(): number {
    let total = 0;
    for (const bytes of this.cache.values()) {
      total += bytes.byteLength;
    }
    return total;
  }
}

/**
 * Create a browser ZK config provider for the TOTP verifier contract.
 */
export function createTotpVerifierZkConfigProvider(): BrowserZkConfigProvider {
  return new BrowserZkConfigProvider('totp-verifier');
}
