/**
 * Proof Generation Module
 *
 * Provides ZK proof generation with multiple backend support:
 * - LaceProofProvider: Lace wallet integration
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
export { LaceProofProvider, createLaceProofProvider, isLaceAvailable } from './lace-provider.js';

// Service
export { ProofService, getProofService, resetProofService } from './service.js';
