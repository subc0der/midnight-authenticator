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
import { clearSensitiveBuffers } from './types.js';
import {
  isWalletDetected,
  callWalletMethod,
  getWalletServiceConfig,
  generateWalletProof,
  type WalletServiceConfig,
} from './wallet-bridge.js';
import { CONTRACT_ADDRESSES } from '@midnight-authenticator/contracts';

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
   * This triggers the full proof generation flow via page context:
   * 1. Connect to wallet (1AM preferred, server-side ProofStation)
   * 2. Create ZK config provider from bundled circuit assets
   * 3. Get proving provider from wallet
   * 4. Build and prove transaction
   * 5. Balance and submit to network
   *
   * @param request - The proof request containing account, secret, and timing data
   * @returns The proof result with transaction hash on success
   */
  async generateAuthProof(request: ProofRequest): Promise<ProofResult> {
    const status = await queryWalletStatus();

    if (!status.available) {
      return {
        success: false,
        error: 'No Midnight wallet detected. Install 1AM wallet from https://1am.xyz',
        providerName: this.name,
      };
    }

    console.log('[WalletProvider] Starting proof generation via wallet...');
    console.log('[WalletProvider] Account ID:', request.accountId.slice(0, 8), '...');
    console.log('[WalletProvider] Time window:', request.expectedTimeWindow.toString());

    try {
      // Trigger full proof generation via page context
      const result = await generateWalletProof({
        accountId: request.accountId,
        secret: request.secret,
        blinder: request.blinder,
        nonce: request.nonce,
        expectedTimeWindow: request.expectedTimeWindow,
        contractAddress: CONTRACT_ADDRESSES.preprod.totpVerifier,
        networkId: 'preprod',
      });

      // Zero out sensitive witness data in background context
      // Page context also zeroes its copy - this is defense-in-depth
      clearSensitiveBuffers(request.secret, request.blinder);

      if (!result.success) {
        console.error('[WalletProvider] Proof generation failed:', result.error);
        return {
          success: false,
          error: result.error || 'Proof generation failed',
          providerName: this.name,
        };
      }

      console.log('[WalletProvider] Proof generated successfully!');
      console.log('[WalletProvider] Transaction hash:', result.txHash);

      // Return success with proof result
      // Note: For wallet-based proving, we get a txHash back
      // The actual proof bytes are inside the submitted transaction
      return {
        success: true,
        proof: new Uint8Array(0), // Proof is embedded in transaction
        publicInputs: {
          accountId: request.accountId,
          nonce: request.nonce,
          expectedTimeWindow: request.expectedTimeWindow,
          result: true,
        },
        providerName: this.name,
        txHash: result.txHash,
        walletName: result.walletName,
      };
    } catch (error) {
      // Zero out sensitive data even on error
      clearSensitiveBuffers(request.secret, request.blinder);

      console.error('[WalletProvider] Proof generation error:', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Wallet proof generation failed: ${message}`,
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
