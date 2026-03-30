/**
 * Tests for LaceProofProvider
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ProofRequest } from '../types';

// Mock lace-wallet-bridge module BEFORE importing lace-provider
const mockIsLaceDetected = vi.fn();
const mockGetLaceServiceConfig = vi.fn();
const mockCallLaceMethod = vi.fn();

vi.mock('../lace-wallet-bridge.js', () => ({
  isLaceDetected: () => mockIsLaceDetected(),
  getLaceServiceConfig: () => mockGetLaceServiceConfig(),
  callLaceMethod: (...args: unknown[]) => mockCallLaceMethod(...args),
}));

// Now import lace-provider after mocking
import {
  LaceProofProvider,
  createLaceProofProvider,
  isLaceAvailable,
  invalidateLaceCache,
} from '../lace-provider';

// Mock chrome.tabs for backward compatibility tests
const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  tabs: {
    query: mockTabsQuery,
    sendMessage: mockTabsSendMessage,
  },
});

// Mock fetch for HTTP provider used internally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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

describe('LaceProofProvider', () => {
  let provider: LaceProofProvider;

  beforeEach(() => {
    provider = new LaceProofProvider();
    invalidateLaceCache();
    vi.clearAllMocks();
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    // Default mock behavior
    mockIsLaceDetected.mockResolvedValue(false);
    mockGetLaceServiceConfig.mockResolvedValue(null);
    mockCallLaceMethod.mockRejectedValue(new Error('Not mocked'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('name', () => {
    it('should be "lace"', () => {
      expect(provider.name).toBe('lace');
    });
  });

  describe('isAvailable', () => {
    it('should return false when Lace is not detected', async () => {
      mockIsLaceDetected.mockResolvedValue(false);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when Lace has no prover URI', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue(null);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when Lace config has empty prover URI', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue({ proverServerUri: '' });

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return true when Lace is detected with prover URI', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue({
        proverServerUri: 'http://localhost:6300',
      });

      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });

    it('should call isLaceDetected from wallet bridge', async () => {
      mockIsLaceDetected.mockResolvedValue(false);

      await provider.isAvailable();

      expect(mockIsLaceDetected).toHaveBeenCalled();
    });
  });

  describe('isDetected', () => {
    it('should return true when Lace is detected (even without prover)', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue(null);

      const detected = await provider.isDetected();

      expect(detected).toBe(true);
    });

    it('should return false when Lace is not detected', async () => {
      mockIsLaceDetected.mockResolvedValue(false);

      const detected = await provider.isDetected();

      expect(detected).toBe(false);
    });
  });

  describe('getLaceInfo', () => {
    it('should return availability and prover URI', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue({
        proverServerUri: 'http://lace-prover:6300',
      });

      const info = await provider.getLaceInfo();

      expect(info.available).toBe(true);
      expect(info.proverUri).toBe('http://lace-prover:6300');
    });

    it('should return unavailable when no Lace', async () => {
      mockIsLaceDetected.mockResolvedValue(false);

      const info = await provider.getLaceInfo();

      expect(info.available).toBe(false);
      expect(info.proverUri).toBeUndefined();
    });
  });

  describe('generateAuthProof', () => {
    it('should return error when Lace not available', async () => {
      mockIsLaceDetected.mockResolvedValue(false);

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Lace wallet not detected');
      expect(result.providerName).toBe('lace');
    });

    it('should return error when no prover URI configured', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue(null);

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('proof server configured');
      expect(result.providerName).toBe('lace');
    });

    it('should return not implemented error when Lace is configured', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue({
        proverServerUri: 'http://lace-prover:6300',
      });
      // Mock getUnshieldedAddress succeeding
      mockCallLaceMethod.mockImplementation((method: string) => {
        if (method === 'getUnshieldedAddress') return Promise.resolve('test-address-12345');
        return Promise.reject(new Error('Not mocked'));
      });

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      // Should return "not implemented" since Lace v4.0.1 doesn't expose direct proof gen
      expect(result.success).toBe(false);
      expect(result.error).toContain('not yet implemented');
      expect(result.providerName).toBe('lace');
    });

    it('should return connection error when Lace call fails', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue({
        proverServerUri: 'http://lace-prover:6300',
      });
      // Mock getUnshieldedAddress failing
      mockCallLaceMethod.mockRejectedValue(new Error('Wallet disconnected'));

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Lace connection failed');
      expect(result.providerName).toBe('lace');
    });
  });

  describe('caching', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should cache Lace status', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue(null);

      await provider.isDetected();
      await provider.isDetected();

      // Should only query once (cached) - isLaceDetected is called once
      expect(mockIsLaceDetected).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue(null);

      await provider.isDetected();

      // Fast-forward past cache TTL (30 seconds)
      await vi.advanceTimersByTimeAsync(31000);

      await provider.isDetected();

      // Should query twice (cache expired)
      expect(mockIsLaceDetected).toHaveBeenCalledTimes(2);
    });

    it('should use cached value within TTL', async () => {
      mockIsLaceDetected.mockResolvedValue(true);
      mockGetLaceServiceConfig.mockResolvedValue(null);

      await provider.isDetected();

      // Fast-forward less than TTL
      await vi.advanceTimersByTimeAsync(10000);

      await provider.isDetected();

      // Should only query once (still cached)
      expect(mockIsLaceDetected).toHaveBeenCalledTimes(1);
    });
  });
});

describe('invalidateLaceCache', () => {
  beforeEach(() => {
    invalidateLaceCache(); // Clear cache before test
    vi.clearAllMocks();
    mockIsLaceDetected.mockResolvedValue(true);
    mockGetLaceServiceConfig.mockResolvedValue(null);
  });

  it('should clear cached status', async () => {
    const provider = new LaceProofProvider();

    // First call - should query
    await provider.isDetected();
    expect(mockIsLaceDetected).toHaveBeenCalledTimes(1);

    // Second call - should use cache (same call count)
    await provider.isDetected();
    expect(mockIsLaceDetected).toHaveBeenCalledTimes(1);

    // Invalidate cache
    invalidateLaceCache();

    // Third call - should query again since cache was cleared
    await provider.isDetected();
    expect(mockIsLaceDetected).toHaveBeenCalledTimes(2);
  });
});

describe('isLaceAvailable', () => {
  beforeEach(() => {
    invalidateLaceCache();
    vi.clearAllMocks();
  });

  it('should return true when Lace is available', async () => {
    mockIsLaceDetected.mockResolvedValue(true);

    const available = await isLaceAvailable();

    expect(available).toBe(true);
  });

  it('should return false when Lace is not available', async () => {
    mockIsLaceDetected.mockResolvedValue(false);

    const available = await isLaceAvailable();

    expect(available).toBe(false);
  });
});

describe('createLaceProofProvider', () => {
  it('should create a LaceProofProvider', () => {
    const provider = createLaceProofProvider();
    expect(provider).toBeInstanceOf(LaceProofProvider);
    expect(provider.name).toBe('lace');
  });
});
