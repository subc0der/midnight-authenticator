/**
 * Mock Proof Provider
 *
 * Returns fake proof data for development and demos.
 * MUST be disabled in production builds.
 */

import type { ProofProvider, ProofRequest, ProofResult } from './types.js';

/** Simulated proof generation delay in milliseconds */
const MOCK_DELAY_MS = 2000;

/** Mock proof prefix for identification */
const MOCK_PROOF_PREFIX = new Uint8Array([0x4d, 0x4f, 0x43, 0x4b]); // "MOCK"

/**
 * Check if the extension is running in development mode.
 * Development mode is detected by absence of update_url in manifest.
 */
function isDevelopment(): boolean {
  try {
    const manifest = chrome.runtime.getManifest();
    return !('update_url' in manifest);
  } catch {
    // If we can't access manifest, assume development
    return true;
  }
}

/**
 * Generate a deterministic mock proof from the request inputs.
 * The proof is fake but consistent for the same inputs.
 */
function generateMockProofBytes(request: ProofRequest): Uint8Array {
  // Create a 256-byte mock proof
  const proofBytes = new Uint8Array(256);

  // Start with MOCK prefix
  proofBytes.set(MOCK_PROOF_PREFIX, 0);

  // Include hash of accountId for some determinism
  for (let i = 0; i < request.accountId.length && i < 32; i++) {
    proofBytes[4 + i] = request.accountId[i] ?? 0;
  }

  // Include nonce bytes
  const nonceBytes = new Uint8Array(8);
  const view = new DataView(nonceBytes.buffer);
  view.setBigUint64(0, request.nonce, false);
  proofBytes.set(nonceBytes, 36);

  // Include timeWindow bytes
  const timeBytes = new Uint8Array(8);
  const timeView = new DataView(timeBytes.buffer);
  timeView.setBigUint64(0, request.expectedTimeWindow, false);
  proofBytes.set(timeBytes, 44);

  // Fill rest with pseudo-random bytes based on inputs
  for (let i = 52; i < 256; i++) {
    const accountByte = request.accountId[i % 32] ?? 0;
    const secretByte = request.secret[i % 32] ?? 0;
    proofBytes[i] = (accountByte ^ secretByte ^ (i * 7)) & 0xff;
  }

  return proofBytes;
}

/**
 * Mock proof provider for development and demos.
 * Returns fake proofs without requiring a real proof server.
 */
export class MockProofProvider implements ProofProvider {
  readonly name = 'mock';

  /**
   * Mock provider is available only in development mode.
   */
  async isAvailable(): Promise<boolean> {
    return isDevelopment();
  }

  /**
   * Generate a mock proof with simulated delay.
   * Validates inputs but returns fake proof data.
   */
  async generateAuthProof(request: ProofRequest): Promise<ProofResult> {
    // Ensure we're in development mode
    if (!isDevelopment()) {
      return {
        success: false,
        error: 'Mock proofs are disabled in production',
        providerName: this.name,
        isMock: true,
      };
    }

    // Validate inputs
    const validationError = this.validateRequest(request);
    if (validationError) {
      return {
        success: false,
        error: validationError,
        providerName: this.name,
        isMock: true,
      };
    }

    // Simulate proof generation delay
    await this.simulateDelay();

    // Generate mock proof bytes
    const proof = generateMockProofBytes(request);

    return {
      success: true,
      proof,
      publicInputs: {
        accountId: request.accountId,
        nonce: request.nonce,
        expectedTimeWindow: request.expectedTimeWindow,
        result: true,
      },
      providerName: this.name,
      isMock: true,
    };
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

  /**
   * Simulate proof generation delay.
   */
  private simulateDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  }
}

/**
 * Check if a proof is a mock proof by checking the prefix.
 */
export function isMockProof(proof: Uint8Array): boolean {
  if (proof.length < MOCK_PROOF_PREFIX.length) {
    return false;
  }
  for (let i = 0; i < MOCK_PROOF_PREFIX.length; i++) {
    if (proof[i] !== MOCK_PROOF_PREFIX[i]) {
      return false;
    }
  }
  return true;
}
