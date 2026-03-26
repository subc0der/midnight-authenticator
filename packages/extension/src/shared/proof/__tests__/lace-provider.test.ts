/**
 * Tests for LaceProofProvider
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  LaceProofProvider,
  createLaceProofProvider,
  isLaceAvailable,
  invalidateLaceCache,
} from '../lace-provider';
import type { ProofRequest } from '../types';

// Mock chrome.tabs
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
    it('should return false when no active tab', async () => {
      mockTabsQuery.mockResolvedValue([]);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when tab has no id', async () => {
      mockTabsQuery.mockResolvedValue([{ url: 'https://example.com' }]);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when tab is chrome:// page', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'chrome://settings' }]);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
      expect(mockTabsSendMessage).not.toHaveBeenCalled();
    });

    it('should return false when tab is extension page', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'chrome-extension://abc123' }]);

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when Lace is not detected', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: false });

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when Lace has no prover URI', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: true, proverUri: null });

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false when content script throws', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockRejectedValue(new Error('No content script'));

      const available = await provider.isAvailable();

      expect(available).toBe(false);
    });

    it('should query active tab with correct parameters', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: false });

      await provider.isAvailable();

      expect(mockTabsQuery).toHaveBeenCalledWith({ active: true, currentWindow: true });
    });

    it('should send CHECK_LACE_AVAILABLE message to content script', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 42, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: false });

      await provider.isAvailable();

      expect(mockTabsSendMessage).toHaveBeenCalledWith(42, { type: 'CHECK_LACE_AVAILABLE' });
    });
  });

  describe('isDetected', () => {
    it('should return true when Lace is detected (even without prover)', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: true });

      const detected = await provider.isDetected();

      expect(detected).toBe(true);
    });

    it('should return false when Lace is not detected', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: false });

      const detected = await provider.isDetected();

      expect(detected).toBe(false);
    });
  });

  describe('getLaceInfo', () => {
    it('should return availability and prover URI', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({
        laceAvailable: true,
        proverUri: 'http://lace-prover:6300',
      });

      const info = await provider.getLaceInfo();

      expect(info.available).toBe(true);
      expect(info.proverUri).toBe('http://lace-prover:6300');
    });

    it('should return unavailable when no Lace', async () => {
      mockTabsQuery.mockResolvedValue([]);

      const info = await provider.getLaceInfo();

      expect(info.available).toBe(false);
      expect(info.proverUri).toBeUndefined();
    });
  });

  describe('generateAuthProof', () => {
    it('should return error when Lace not available', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: false });

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Lace wallet not detected');
      expect(result.providerName).toBe('lace');
    });

    it('should return error when no prover URI configured', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: true, proverUri: null });

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('proof server configured');
      expect(result.providerName).toBe('lace');
    });

    it('should delegate to HTTP provider when Lace is configured', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({
        laceAvailable: true,
        proverUri: 'http://lace-prover:6300',
      });

      const request = createValidRequest();
      const result = await provider.generateAuthProof(request);

      // HTTP provider returns error because isAvailable returns false (SDK pending)
      expect(result.success).toBe(false);
      expect(result.providerName).toBe('lace'); // Still marked as lace
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
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: true });

      await provider.isDetected();
      await provider.isDetected();

      // Should only query once (cached)
      expect(mockTabsSendMessage).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: true });

      await provider.isDetected();

      // Fast-forward past cache TTL (30 seconds)
      await vi.advanceTimersByTimeAsync(31000);

      await provider.isDetected();

      // Should query twice (cache expired)
      expect(mockTabsSendMessage).toHaveBeenCalledTimes(2);
    });

    it('should use cached value within TTL', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
      mockTabsSendMessage.mockResolvedValue({ laceAvailable: true });

      await provider.isDetected();

      // Fast-forward less than TTL
      await vi.advanceTimersByTimeAsync(10000);

      await provider.isDetected();

      // Should only query once (still cached)
      expect(mockTabsSendMessage).toHaveBeenCalledTimes(1);
    });
  });
});

describe('invalidateLaceCache', () => {
  beforeEach(() => {
    invalidateLaceCache(); // Clear cache before test
    vi.clearAllMocks();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
    mockTabsSendMessage.mockResolvedValue({ laceAvailable: true });
  });

  it('should clear cached status', async () => {
    const provider = new LaceProofProvider();

    // First call - should query content script
    await provider.isDetected();
    expect(mockTabsSendMessage).toHaveBeenCalledTimes(1);

    // Second call - should use cache (same call count)
    await provider.isDetected();
    expect(mockTabsSendMessage).toHaveBeenCalledTimes(1);

    // Invalidate cache
    invalidateLaceCache();

    // Third call - should query again since cache was cleared
    await provider.isDetected();
    expect(mockTabsSendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('isLaceAvailable', () => {
  beforeEach(() => {
    invalidateLaceCache();
    vi.clearAllMocks();
  });

  it('should return true when Lace is available', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
    mockTabsSendMessage.mockResolvedValue({ laceAvailable: true });

    const available = await isLaceAvailable();

    expect(available).toBe(true);
  });

  it('should return false when Lace is not available', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
    mockTabsSendMessage.mockResolvedValue({ laceAvailable: false });

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
