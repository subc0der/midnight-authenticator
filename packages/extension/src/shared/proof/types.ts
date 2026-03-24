/**
 * Proof Provider Abstraction Types
 *
 * Defines interfaces for ZK proof generation with multiple backend support:
 * - MockProofProvider: Development/demos (no Docker needed)
 * - HttpProofProvider: Direct Docker proof server connection
 * - LaceProofProvider: Lace wallet integration (future-ready)
 */

/**
 * Request for generating an authentication proof.
 * Contains all inputs needed for the authenticate() circuit.
 */
export interface ProofRequest {
  /** 32-byte account identifier */
  accountId: Uint8Array;
  /** Monotonically increasing nonce for replay protection */
  nonce: bigint;
  /** Current 30-second time window (public input) */
  expectedTimeWindow: bigint;
  /** 32-byte secret (witness - never revealed) */
  secret: Uint8Array;
  /** 32-byte blinder (witness - never revealed) */
  blinder: Uint8Array;
}

/**
 * Public inputs that are part of the proof.
 * These are visible to verifiers on-chain.
 */
export interface ProofPublicInputs {
  /** Account being authenticated */
  accountId: Uint8Array;
  /** Nonce used (prevents replay) */
  nonce: bigint;
  /** Time window the proof is bound to */
  expectedTimeWindow: bigint;
  /** Authentication result (always true for valid proofs) */
  result: boolean;
}

/**
 * Result of proof generation.
 */
export interface ProofResult {
  /** Whether proof generation succeeded */
  success: boolean;
  /** The generated proof bytes (if successful) */
  proof?: Uint8Array;
  /** Public inputs included in the proof */
  publicInputs?: ProofPublicInputs;
  /** Error message (if failed) */
  error?: string;
  /** Which provider generated the proof */
  providerName?: string;
  /** Whether this is a mock proof (for UI indication) */
  isMock?: boolean;
}

/**
 * Interface for proof generation providers.
 * Implementations handle the actual proof generation via different backends.
 */
export interface ProofProvider {
  /** Human-readable name for this provider */
  readonly name: string;

  /**
   * Check if this provider is currently available.
   * Called before attempting proof generation.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Generate an authentication proof.
   * @param request - The proof request with all required inputs
   * @returns ProofResult with proof bytes or error
   */
  generateAuthProof(request: ProofRequest): Promise<ProofResult>;
}

/**
 * Configuration for the proof service.
 */
export interface ProofServiceConfig {
  /** URL of the local proof server (default: http://localhost:6300) */
  proofServerUrl?: string;
  /** Timeout for proof generation in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Whether to allow mock proofs (should be false in production) */
  allowMockProofs?: boolean;
  /** Force a specific provider (for dev/testing) */
  preferredProvider?: 'lace' | 'http' | 'mock' | null;
}

/**
 * Status of the proof service.
 */
export interface ProofServiceStatus {
  /** Name of the currently active provider */
  activeProvider: string | null;
  /** Whether proof server is reachable */
  proofServerAvailable: boolean;
  /** Whether Lace wallet is detected */
  laceAvailable: boolean;
  /** Whether mock proofs are enabled */
  mockEnabled: boolean;
}

/**
 * Auth request from a dApp.
 * Stored in chrome.storage while awaiting user approval.
 */
export interface PendingAuthRequest {
  /** Unique request identifier */
  requestId: string;
  /** Origin of the requesting dApp */
  origin: string;
  /** Account ID to authenticate */
  accountId: string;
  /** Optional challenge from the dApp */
  challenge?: string;
  /** Timestamp when request was created */
  createdAt: number;
  /** Request expiration timestamp */
  expiresAt: number;
  /** Current status */
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'expired';
  /** Proof result (if completed) */
  result?: ProofResult;
}

/**
 * Response sent back to dApp after auth request.
 */
export interface AuthResponse {
  /** Whether authentication succeeded */
  success: boolean;
  /** The generated proof (if successful) */
  proof?: Uint8Array;
  /** Public inputs for verification */
  publicInputs?: ProofPublicInputs;
  /** Error message (if failed) */
  error?: string;
  /** Whether this was a mock proof */
  isMock?: boolean;
}

// =============================================================================
// Offscreen Document Message Types
// =============================================================================

/**
 * Service URIs for connecting to Midnight infrastructure.
 */
export interface ServiceUris {
  /** Proof server URL (e.g., http://localhost:6300) */
  proverServerUri: string;
  /** Circuit assets URL (e.g., http://localhost:3000/circuits/totp-verifier/) */
  circuitAssetsUrl: string;
}

/**
 * Message sent to offscreen document to generate an auth proof.
 */
export interface GenerateAuthProofMessage {
  type: 'GENERATE_AUTH_PROOF';
  serviceUris: ServiceUris;
  /** 32-byte account ID as number array */
  accountId: number[];
  /** Nonce for replay protection (as string for BigInt serialization) */
  nonce: string;
  /** Time window (as string for BigInt serialization) */
  expectedTimeWindow: string;
  /** 32-byte secret as number array */
  secret: number[];
  /** 32-byte blinder as number array */
  blinder: number[];
}

/**
 * Response from offscreen document after proof generation.
 */
export interface GenerateAuthProofResponse {
  type: 'GENERATE_AUTH_PROOF_RESULT';
  success: boolean;
  /** Proof bytes as number array */
  proof?: number[];
  /** Whether authentication succeeded */
  isVerified?: boolean;
  /** Whether this is a mock proof */
  isMock: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Message to check if proof provider is available.
 */
export interface CheckProofAvailabilityMessage {
  type: 'CHECK_PROOF_AVAILABILITY';
  serviceUris: ServiceUris;
}

/**
 * Response for proof availability check.
 */
export interface CheckProofAvailabilityResponse {
  type: 'CHECK_PROOF_AVAILABILITY_RESULT';
  available: boolean;
  error?: string;
}
