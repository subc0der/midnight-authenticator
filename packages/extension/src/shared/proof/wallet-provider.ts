/**
 * Wallet Proof Provider
 *
 * Integrates with Midnight wallets for ZK proof generation.
 * Supports multiple wallets via the DApp Connector API:
 * - 1AM (preferred): Server-side proving via ProofStation, no Docker required
 * - Lace: Local proving via Docker proof server
 *
 * DApp Connector API v4.0.x:
 * - connect(networkId) returns connected wallet API
 * - getConfiguration() returns { proverServerUri, indexerUri, ... }
 * - getProvingProvider(zkConfigProvider) returns the proving interface
 * - balanceUnsealedTransaction(tx) balances a transaction with fees
 */

import type { ProofProvider, ProofRequest, ProofResult } from './types.js';
import {
  isWalletDetected,
  callWalletMethod,
  getWalletServiceConfig,
  type WalletServiceConfig,
} from './wallet-bridge.js';

/** Cached wallet status to avoid repeated tab queries */
interface WalletStatus {
  available: boolean;
  walletName?: string;
  proverUri?: string;
  checkedAt: number;
}

// Cache wallet status for 30 seconds
const WALLET_CACHE_TTL_MS = 30_000;
let cachedWalletStatus: WalletStatus | null = null;

/**
 * Query wallet availability from the active tab.
 */
async function queryWalletStatus(): Promise<WalletStatus> {
  // Return cached status if still valid
  if (cachedWalletStatus && Date.now() - cachedWalletStatus.checkedAt < WALLET_CACHE_TTL_MS) {
    return cachedWalletStatus;
  }

  const available = await isWalletDetected();
  let proverUri: string | undefined;

  if (available) {
    const config = await getWalletServiceConfig();
    proverUri = config?.proverServerUri;
  }

  cachedWalletStatus = {
    available,
    proverUri,
    checkedAt: Date.now(),
  };

  return cachedWalletStatus;
}

/**
 * Invalidate the wallet status cache.
 */
export function invalidateWalletCache(): void {
  cachedWalletStatus = null;
}

/**
 * Wallet proof provider that uses wallet's getProvingProvider() for ZK proof generation.
 *
 * Priority: 1AM > Lace
 * - 1AM: Server-side proving via ProofStation (no Docker required, faster)
 * - Lace: Local proving via Docker proof server
 */
export class WalletProofProvider implements ProofProvider {
  readonly name = 'wallet';

  /**
   * Check if a Midnight wallet is available and configured.
   */
  async isAvailable(): Promise<boolean> {
    const status = await queryWalletStatus();
    return status.available && !!status.proverUri;
  }

  /**
   * Generate an authentication proof using the wallet.
   *
   * The wallet provides getProvingProvider(zkConfigProvider) which returns
   * the proving interface. We then build the proof using:
   *   unprovenTx.prove(provingProvider, costModel)
   *
   * Note: Full implementation requires SDK transaction building.
   * This is a placeholder until SDK integration is complete.
   */
  async generateAuthProof(request: ProofRequest): Promise<ProofResult> {
    const status = await queryWalletStatus();

    if (!status.available) {
      return {
        success: false,
        error: 'No Midnight wallet detected. Please install 1AM or Lace wallet extension.',
        providerName: this.name,
      };
    }

    if (!status.proverUri) {
      return {
        success: false,
        error: 'Wallet does not have a proof server configured.',
        providerName: this.name,
      };
    }

    try {
      console.log('[WalletProvider] Wallet detected, verifying connectivity...');
      console.log('[WalletProvider] Prover URI:', status.proverUri);

      // Get wallet address to verify connection works
      const address = await callWalletMethod<string>('getUnshieldedAddress');
      console.log('[WalletProvider] Connected to wallet:', address.slice(0, 20) + '...');

      // TODO: Implement full proof generation flow:
      // 1. Create BrowserZkConfigProvider for our circuit
      // 2. Call getProvingProvider(zkConfigProvider) on wallet
      // 3. Build unproven transaction using contract
      // 4. Call unprovenTx.prove(provingProvider, costModel)
      // 5. Balance transaction with balanceUnsealedTransaction()
      //
      // This requires the full Midnight SDK transaction flow.
      // For now, fall back to mock provider in development.

      return {
        success: false,
        error: 'Wallet proof generation pending SDK integration. Use mock provider for development.',
        providerName: this.name,
      };
    } catch (error) {
      console.error('[WalletProvider] Wallet connection failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Wallet connection failed: ${message}`,
        providerName: this.name,
      };
    }
  }

  /**
   * Get information about wallet configuration.
   */
  async getWalletInfo(): Promise<{
    available: boolean;
    walletName?: string;
    proverUri?: string;
  }> {
    const status = await queryWalletStatus();
    return {
      available: status.available,
      walletName: status.walletName,
      proverUri: status.proverUri,
    };
  }

  /**
   * Check if a wallet is detected (regardless of prover availability).
   */
  async isDetected(): Promise<boolean> {
    const status = await queryWalletStatus();
    return status.available;
  }
}

/**
 * Check if a Midnight wallet is installed and available.
 */
export async function isWalletAvailable(): Promise<boolean> {
  const status = await queryWalletStatus();
  return status.available;
}

/**
 * Create a wallet proof provider.
 */
export function createWalletProofProvider(): WalletProofProvider {
  return new WalletProofProvider();
}

// Legacy exports for backward compatibility
export {
  WalletProofProvider as LaceProofProvider,
  createWalletProofProvider as createLaceProofProvider,
  isWalletAvailable as isLaceAvailable,
  invalidateWalletCache as invalidateLaceCache,
};
