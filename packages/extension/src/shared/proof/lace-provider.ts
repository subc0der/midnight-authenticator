/**
 * Lace Proof Provider
 *
 * Integrates with the Lace wallet for ZK proof generation.
 *
 * Lace v4.0.1 API:
 * - connect(networkId) returns connected wallet API
 * - getConfiguration() returns { proverServerUri, indexerUri, ... }
 * - balanceSealedTransaction(tx) balances and proves a transaction
 *
 * Current status:
 * - Lace detection and configuration retrieval: WORKING
 * - Direct proof generation: NOT AVAILABLE (getProvingProvider is undefined)
 * - Transaction-based proofs: REQUIRES full SDK transaction building
 *
 * For authentication proofs without on-chain state changes, we need either:
 * 1. Lace to expose getProvingProvider (not currently available)
 * 2. Build full SDK transaction flow with balanceSealedTransaction
 * 3. Call proof server directly (if API format is known)
 */

import type { ProofProvider, ProofRequest, ProofResult } from './types.js';
import {
  isLaceDetected,
  callLaceMethod,
  getLaceServiceConfig,
  type LaceServiceConfig,
} from './lace-wallet-bridge.js';

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
 * Query Lace availability from the active tab.
 */
async function queryLaceStatus(): Promise<LaceStatus> {
  // Return cached status if still valid
  if (cachedLaceStatus && Date.now() - cachedLaceStatus.checkedAt < LACE_CACHE_TTL_MS) {
    return cachedLaceStatus;
  }

  const available = await isLaceDetected();
  let proverUri: string | undefined;

  if (available) {
    const config = await getLaceServiceConfig();
    proverUri = config?.proverServerUri;
  }

  cachedLaceStatus = {
    available,
    proverUri,
    checkedAt: Date.now(),
  };

  return cachedLaceStatus;
}

/**
 * Invalidate the Lace status cache.
 */
export function invalidateLaceCache(): void {
  cachedLaceStatus = null;
}

/**
 * Lace wallet provider that uses Lace's balanceAndProveTransaction() for proof generation.
 *
 * NOTE: This is a simplified implementation that demonstrates the integration pattern.
 * Full SDK transaction building requires additional setup that may have browser
 * compatibility issues. This version uses a workaround that calls Lace directly
 * with the proof request data.
 */
export class LaceProofProvider implements ProofProvider {
  readonly name = 'lace';

  /**
   * Check if Lace wallet is available and configured.
   */
  async isAvailable(): Promise<boolean> {
    const status = await queryLaceStatus();
    return status.available && !!status.proverUri;
  }

  /**
   * Generate an authentication proof using Lace wallet.
   *
   * Current limitation: Lace v4.0.1 doesn't expose getProvingProvider,
   * so we cannot directly generate proofs. We need to either:
   * 1. Build full SDK transaction and use balanceSealedTransaction()
   * 2. Wait for Lace to expose direct proof generation
   *
   * For now, this verifies Lace connectivity but returns a "not implemented" error.
   */
  async generateAuthProof(request: ProofRequest): Promise<ProofResult> {
    const status = await queryLaceStatus();

    if (!status.available) {
      return {
        success: false,
        error: 'Lace wallet not detected. Please install Lace Midnight Preview extension.',
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

    try {
      console.log('[LaceProvider] Lace detected, verifying connectivity...');
      console.log('[LaceProvider] Prover URI:', status.proverUri);

      // Get wallet address to verify connection works
      const address = await callLaceMethod<string>('getUnshieldedAddress');
      console.log('[LaceProvider] Connected to wallet:', address.slice(0, 20) + '...');

      // Currently, Lace v4.0.1 doesn't expose direct proof generation.
      // getProvingProvider is undefined in the API.
      //
      // Options for future implementation:
      // 1. Build unbalanced transaction using SDK and pass to balanceSealedTransaction()
      // 2. Call proof server directly (need to discover API format)
      // 3. Wait for Lace to expose proof provider
      //
      // For now, fall back to mock provider if available

      return {
        success: false,
        error: 'Lace proof generation not yet implemented. Lace v4.0.1 does not expose direct proof generation. Use mock provider for development.',
        providerName: this.name,
      };
    } catch (error) {
      console.error('[LaceProvider] Lace connection failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Lace connection failed: ${message}`,
        providerName: this.name,
      };
    }
  }

  /**
   * Get information about Lace's configuration.
   */
  async getLaceInfo(): Promise<{
    available: boolean;
    proverUri?: string;
  }> {
    const status = await queryLaceStatus();
    return {
      available: status.available,
      proverUri: status.proverUri,
    };
  }

  /**
   * Check if Lace wallet is detected (regardless of prover availability).
   */
  async isDetected(): Promise<boolean> {
    const status = await queryLaceStatus();
    return status.available;
  }
}

/**
 * Check if Lace wallet is installed and available.
 */
export async function isLaceAvailable(): Promise<boolean> {
  const status = await queryLaceStatus();
  return status.available;
}

/**
 * Create a Lace proof provider.
 */
export function createLaceProofProvider(): LaceProofProvider {
  return new LaceProofProvider();
}
