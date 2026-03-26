/**
 * Tests for MockProofProvider
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockProofProvider, isMockProof } from '../mock-provider';
import type { ProofRequest } from '../types';

// Mock chrome.runtime.getManifest
const mockGetManifest = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    getManifest: mockGetManifest,
  },
});

/**
 * Create a valid proof request for testing.
 */
function createValidRequest(overrides: Partial<ProofRequest> = {}): ProofRequest {
  return {
    accountId: new Uint8Array(32).fill(1),
    secret: new Uint8Array(32).fill(2),
    blinder: new Uint8Array(32).fill(3),
    nonce: 12345n,
    expectedTimeWindow: 54321n,
    ...overrides,
  };
}

describe('MockProofProvider', () => {
  let provider: MockProofProvider;

  beforeEach(() => {
    provider = new MockProofProvider();
    vi.useFakeTimers();
    // Default to development mode (no update_url)
    mockGetManifest.mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('name', () => {
    it('should be "mock"', () => {
      expect(provider.name).toBe('mock');
    });
  });

  describe('isAvailable', () => {
    it('should return true in development mode (no update_url)', async () => {
      mockGetManifest.mockReturnValue({});
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return false in production mode (has update_url)', async () => {
      mockGetManifest.mockReturnValue({ update_url: 'https://example.com/updates' });
      expect(await provider.isAvailable()).toBe(false);
    });

    it('should return true if getManifest throws', async () => {
      mockGetManifest.mockImplementation(() => {
        throw new Error('No manifest');
      });
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('generateAuthProof', () => {
    describe('in development mode', () => {
      beforeEach(() => {
        mockGetManifest.mockReturnValue({});
      });

      it('should generate a successful mock proof', async () => {
        const request = createValidRequest();

        const resultPromise = provider.generateAuthProof(request);

        // Fast-forward past the simulated delay
        await vi.advanceTimersByTimeAsync(2000);

        const result = await resultPromise;

        expect(result.success).toBe(true);
        expect(result.proof).toBeDefined();
        expect(result.proof).toBeInstanceOf(Uint8Array);
        expect(result.proof!.length).toBe(256);
        expect(result.providerName).toBe('mock');
        expect(result.isMock).toBe(true);
      });

      it('should include correct public inputs', async () => {
        const request = createValidRequest({
          accountId: new Uint8Array(32).fill(42),
          nonce: 999n,
          expectedTimeWindow: 888n,
        });

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(true);
        expect(result.publicInputs).toEqual({
          accountId: request.accountId,
          nonce: 999n,
          expectedTimeWindow: 888n,
          result: true,
        });
      });

      it('should generate deterministic proofs for same inputs', async () => {
        const request = createValidRequest();

        const resultPromise1 = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result1 = await resultPromise1;

        const resultPromise2 = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result2 = await resultPromise2;

        expect(result1.proof).toEqual(result2.proof);
      });

      it('should generate different proofs for different inputs', async () => {
        const request1 = createValidRequest({ nonce: 1n });
        const request2 = createValidRequest({ nonce: 2n });

        const resultPromise1 = provider.generateAuthProof(request1);
        await vi.advanceTimersByTimeAsync(2000);
        const result1 = await resultPromise1;

        const resultPromise2 = provider.generateAuthProof(request2);
        await vi.advanceTimersByTimeAsync(2000);
        const result2 = await resultPromise2;

        expect(result1.proof).not.toEqual(result2.proof);
      });

      it('should include MOCK prefix in generated proof', async () => {
        const request = createValidRequest();

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        // Check for "MOCK" prefix (0x4d, 0x4f, 0x43, 0x4b)
        expect(result.proof![0]).toBe(0x4d); // M
        expect(result.proof![1]).toBe(0x4f); // O
        expect(result.proof![2]).toBe(0x43); // C
        expect(result.proof![3]).toBe(0x4b); // K
      });
    });

    describe('in production mode', () => {
      beforeEach(() => {
        mockGetManifest.mockReturnValue({ update_url: 'https://example.com' });
      });

      it('should return error for mock proofs', async () => {
        const request = createValidRequest();

        const result = await provider.generateAuthProof(request);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Mock proofs are disabled in production');
        expect(result.providerName).toBe('mock');
        expect(result.isMock).toBe(true);
      });
    });

    describe('validation', () => {
      beforeEach(() => {
        mockGetManifest.mockReturnValue({});
      });

      it('should reject invalid accountId (wrong length)', async () => {
        const request = createValidRequest({
          accountId: new Uint8Array(16), // Should be 32
        });

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid accountId: must be 32 bytes');
      });

      it('should reject missing accountId', async () => {
        const request = createValidRequest();
        // @ts-expect-error Testing invalid input
        request.accountId = null;

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid accountId');
      });

      it('should reject invalid secret (wrong length)', async () => {
        const request = createValidRequest({
          secret: new Uint8Array(16), // Should be 32
        });

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid secret: must be 32 bytes');
      });

      it('should reject invalid blinder (wrong length)', async () => {
        const request = createValidRequest({
          blinder: new Uint8Array(16), // Should be 32
        });

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid blinder: must be 32 bytes');
      });

      it('should reject negative nonce', async () => {
        const request = createValidRequest({
          nonce: -1n,
        });

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid nonce: must be non-negative bigint');
      });

      it('should reject non-bigint nonce', async () => {
        const request = createValidRequest();
        // @ts-expect-error Testing invalid input
        request.nonce = 12345;

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid nonce: must be non-negative bigint');
      });

      it('should reject negative expectedTimeWindow', async () => {
        const request = createValidRequest({
          expectedTimeWindow: -1n,
        });

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid expectedTimeWindow: must be non-negative bigint');
      });

      it('should accept zero values for nonce and timeWindow', async () => {
        const request = createValidRequest({
          nonce: 0n,
          expectedTimeWindow: 0n,
        });

        const resultPromise = provider.generateAuthProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(true);
      });
    });
  });
});

describe('isMockProof', () => {
  it('should return true for proof with MOCK prefix', () => {
    const mockProof = new Uint8Array(256);
    mockProof[0] = 0x4d; // M
    mockProof[1] = 0x4f; // O
    mockProof[2] = 0x43; // C
    mockProof[3] = 0x4b; // K

    expect(isMockProof(mockProof)).toBe(true);
  });

  it('should return false for proof without MOCK prefix', () => {
    const realProof = new Uint8Array(256);
    realProof[0] = 0x00;
    realProof[1] = 0x01;
    realProof[2] = 0x02;
    realProof[3] = 0x03;

    expect(isMockProof(realProof)).toBe(false);
  });

  it('should return false for empty proof', () => {
    const emptyProof = new Uint8Array(0);
    expect(isMockProof(emptyProof)).toBe(false);
  });

  it('should return false for proof shorter than prefix', () => {
    const shortProof = new Uint8Array(3);
    shortProof[0] = 0x4d;
    shortProof[1] = 0x4f;
    shortProof[2] = 0x43;

    expect(isMockProof(shortProof)).toBe(false);
  });

  it('should return false for partial MOCK prefix', () => {
    const partialProof = new Uint8Array(256);
    partialProof[0] = 0x4d; // M
    partialProof[1] = 0x4f; // O
    partialProof[2] = 0x43; // C
    partialProof[3] = 0x00; // Not K

    expect(isMockProof(partialProof)).toBe(false);
  });
});
