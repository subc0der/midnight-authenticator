/**
 * Tests for WalletProofProvider
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ProofRequest } from '../types';

// Mock wallet-bridge module BEFORE importing wallet-provider
const mockIsWalletDetected = vi.fn();
const mockGetWalletServiceConfig = vi.fn();
const mockCallWalletMethod = vi.fn();

vi.mock('../wallet-bridge.js', () => ({
  isWalletDetected: () => mockIsWalletDetected(),
  getWalletServiceConfig: () => mockGetWalletServiceConfig(),
  callWalletMethod: (...args: unknown[]) => mockCallWalletMethod(...args),
}));

// Now import wallet-provider after mocking
import {
  WalletProofProvider,
  createWalletProofProvider,
  isWalletAvailable,
  invalidateWalletCache,
} from '../wallet-provider';

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

describe('WalletProofProvider', () => {
  let provider: WalletProofProvider;

  beforeEach(() => {
    provider = new WalletProofProvider();
    invalidateWalletCache();
    vi.clearAllMocks();
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    // Default mock behavior
    mockIsWalletDetected.mockResolvedValue(false);
    mockGetWalletServiceConfig.mockResolvedValue(null);
    mockCallWalletMethod.mockRejectedValue(new Error('Not mocked'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('name', () => {
    it('should be "wallet"', () => {
      expect(provider.name).toBe('wallet');
    });
  });

  describe('isAvailable', () => {
    it('should return false when no wallet is detected', async () => {
      mockIsWalletDetected.mockResolvedValue(false);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when wallet has no prover URI', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue(null);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when wallet config has empty prover URI', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue({ proverServerUri: '' });

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return true when wallet is detected with prover URI', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue({
        proverServerUri: 'http://localhost:6300',
      });

      const available = await provider.isAvailable();

      expect(available).toBe(true);
    });

    it('should call isWalletDetected from wallet bridge', async () => {
      mockIsWalletDetected.mockResolvedValue(false);

      await provider.isAvailable();

      expect(mockIsWalletDetected).toHaveBeenCalled();
    });
  });

  describe('isDetected', () => {
    it('should return true when wallet is detected (even without prover)', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue(null);

      const detected = await provider.isDetected();

      expect(detected).toBe(true);
    });

    it('should return false when wallet is not detected', async () => {
      mockIsWalletDetected.mockResolvedValue(false);

      const detected = await provider.isDetected();

      expect(detected).toBe(false);
    });
  });

  describe('getWalletInfo', () => {
    it('should return availability and prover URI', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue({
        proverServerUri: 'http://1am-prover:6300',
      });

      const info = await provider.getWalletInfo();

      expect(info.available).toBe(true);
      expect(info.proverUri).toBe('http://1am-prover:6300');
    });

    it('should return unavailable when no wallet', async () => {
      mockIsWalletDetected.mockResolvedValue(false);

      const info = await provider.getWalletInfo();

      expect(info.available).toBe(false);
      expect(info.proverUri).toBeUndefined();
    });
  });

  describe('generateAuthProof', () => {
    it('should return error when wallet not available', async () => {
      mockIsWalletDetected.mockResolvedValue(false);

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No Midnight wallet detected');
      expect(result.providerName).toBe('wallet');
    });

    it('should return error when no prover URI configured', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue(null);

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('proof server configured');
      expect(result.providerName).toBe('wallet');
    });

    it('should return pending SDK message when wallet is configured', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue({
        proverServerUri: 'http://1am-prover:6300',
      });
      // Mock getUnshieldedAddress succeeding
      mockCallWalletMethod.mockImplementation((method: string) => {
        if (method === 'getUnshieldedAddress') return Promise.resolve('test-address-12345');
        return Promise.reject(new Error('Not mocked'));
      });

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      // Should return "pending SDK" since full integration is not yet complete
      expect(result.success).toBe(false);
      expect(result.error).toContain('pending SDK integration');
      expect(result.providerName).toBe('wallet');
    });

    it('should return connection error when wallet call fails', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue({
        proverServerUri: 'http://1am-prover:6300',
      });
      // Mock getUnshieldedAddress failing
      mockCallWalletMethod.mockRejectedValue(new Error('Wallet disconnected'));

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Wallet connection failed');
      expect(result.providerName).toBe('wallet');
    });
  });

  describe('caching', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should cache wallet status', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue(null);

      await provider.isDetected();
      await provider.isDetected();

      // Should only query once (cached) - isWalletDetected is called once
      expect(mockIsWalletDetected).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue(null);

      await provider.isDetected();

      // Fast-forward past cache TTL (30 seconds)
      await vi.advanceTimersByTimeAsync(31000);

      await provider.isDetected();

      // Should query twice (cache expired)
      expect(mockIsWalletDetected).toHaveBeenCalledTimes(2);
    });

    it('should use cached value within TTL', async () => {
      mockIsWalletDetected.mockResolvedValue(true);
      mockGetWalletServiceConfig.mockResolvedValue(null);

      await provider.isDetected();

      // Fast-forward less than TTL
      await vi.advanceTimersByTimeAsync(10000);

      await provider.isDetected();

      // Should only query once (still cached)
      expect(mockIsWalletDetected).toHaveBeenCalledTimes(1);
    });
  });
});

describe('invalidateWalletCache', () => {
  beforeEach(() => {
    invalidateWalletCache(); // Clear cache before test
    vi.clearAllMocks();
    mockIsWalletDetected.mockResolvedValue(true);
    mockGetWalletServiceConfig.mockResolvedValue(null);
  });

  it('should clear cached status', async () => {
    const provider = new WalletProofProvider();

    // First call - should query
    await provider.isDetected();
    expect(mockIsWalletDetected).toHaveBeenCalledTimes(1);

    // Second call - should use cache (same call count)
    await provider.isDetected();
    expect(mockIsWalletDetected).toHaveBeenCalledTimes(1);

    // Invalidate cache
    invalidateWalletCache();

    // Third call - should query again since cache was cleared
    await provider.isDetected();
    expect(mockIsWalletDetected).toHaveBeenCalledTimes(2);
  });
});

describe('isWalletAvailable', () => {
  beforeEach(() => {
    invalidateWalletCache();
    vi.clearAllMocks();
  });

  it('should return true when wallet is available', async () => {
    mockIsWalletDetected.mockResolvedValue(true);

    const available = await isWalletAvailable();

    expect(available).toBe(true);
  });

  it('should return false when wallet is not available', async () => {
    mockIsWalletDetected.mockResolvedValue(false);

    const available = await isWalletAvailable();

    expect(available).toBe(false);
  });
});

describe('createWalletProofProvider', () => {
  it('should create a WalletProofProvider', () => {
    const provider = createWalletProofProvider();
    expect(provider).toBeInstanceOf(WalletProofProvider);
    expect(provider.name).toBe('wallet');
  });
});
