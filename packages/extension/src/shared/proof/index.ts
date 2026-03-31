/**
 * Proof Generation Module
 *
 * Provides ZK proof generation with multiple backend support:
 * - WalletProofProvider: Midnight wallet integration (1AM preferred, Lace fallback)
 * - HttpProofProvider: Docker proof server
 * - MockProofProvider: Development/demos
 */

// Types
export type {
  ProofRequest,
  ProofResult,
  ProofPublicInputs,
  ProofProvider,
  ProofServiceConfig,
  ProofServiceStatus,
  PendingAuthRequest,
  AuthResponse,
} from './types.js';

// Providers
export { MockProofProvider, isMockProof } from './mock-provider.js';
export { HttpProofProvider, createHttpProofProvider } from './http-provider.js';
export {
  WalletProofProvider,
  createWalletProofProvider,
  isWalletAvailable,
  invalidateWalletCache,
  // Legacy exports for backward compatibility
  LaceProofProvider,
  createLaceProofProvider,
  isLaceAvailable,
} from './wallet-provider.js';

// Service
export { ProofService, getProofService, resetProofService } from './service.js';
