/**
 * Tests for HttpProofProvider
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HttpProofProvider, createHttpProofProvider } from '../http-provider';
import type { ProofRequest } from '../types';

// Mock fetch
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

describe('HttpProofProvider', () => {
  let provider: HttpProofProvider;

  beforeEach(() => {
    provider = new HttpProofProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('name', () => {
    it('should be "http"', () => {
      expect(provider.name).toBe('http');
    });
  });

  describe('constructor', () => {
    it('should use default URL when none provided', () => {
      const defaultProvider = new HttpProofProvider();
      expect(defaultProvider).toBeInstanceOf(HttpProofProvider);
    });

    it('should accept custom URL', () => {
      const customProvider = new HttpProofProvider('http://custom:1234');
      expect(customProvider).toBeInstanceOf(HttpProofProvider);
    });
  });

  describe('isAvailable', () => {
    it('should return false (SDK integration pending)', async () => {
      // Currently always returns false until SDK integration
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('canConnectToServer', () => {
    it('should return true when server responds OK', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '8.0.3' }),
      });

      const canConnect = await provider.canConnectToServer();

      expect(canConnect).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6300/version',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false when server responds with error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const canConnect = await provider.canConnectToServer();

      expect(canConnect).toBe(false);
    });

    it('should return false when server is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const canConnect = await provider.canConnectToServer();

      expect(canConnect).toBe(false);
    });

    it('should return false on timeout', async () => {
      // Mock AbortController behavior - when abort is called, fetch rejects
      mockFetch.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new Error('Aborted'));
            });
          }
        });
      });

      // The implementation uses a 5 second timeout, so this should abort
      const canConnect = await provider.canConnectToServer();
      expect(canConnect).toBe(false);
    }, 10000);

    it('should use custom URL when provided', async () => {
      const customProvider = new HttpProofProvider('http://custom:9999');
      mockFetch.mockResolvedValue({ ok: true });

      await customProvider.canConnectToServer();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:9999/version',
        expect.any(Object)
      );
    });
  });

  describe('getServerVersion', () => {
    it('should return version when server responds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '8.0.3' }),
      });

      const version = await provider.getServerVersion();

      expect(version).toBe('8.0.3');
    });

    it('should handle Version (capitalized) in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ Version: '7.0.0' }),
      });

      const version = await provider.getServerVersion();

      expect(version).toBe('7.0.0');
    });

    it('should stringify unknown response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ unknown: 'data' }),
      });

      const version = await provider.getServerVersion();

      expect(version).toBe('{"unknown":"data"}');
    });

    it('should return null when server is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const version = await provider.getServerVersion();

      expect(version).toBeNull();
    });

    it('should return null when server responds with error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const version = await provider.getServerVersion();

      expect(version).toBeNull();
    });
  });

  describe('generateAuthProof', () => {
    it('should return error when not available', async () => {
      const request = createValidRequest();

      const result = await provider.generateAuthProof(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Proof server not available');
      expect(result.providerName).toBe('http');
    });

    it('should include Docker hint in error', async () => {
      const request = createValidRequest();

      const result = await provider.generateAuthProof(request);

      expect(result.error).toContain('docker start proof-server');
    });
  });
});

describe('createHttpProofProvider', () => {
  it('should create provider with default URL', () => {
    const provider = createHttpProofProvider();
    expect(provider).toBeInstanceOf(HttpProofProvider);
    expect(provider.name).toBe('http');
  });

  it('should create provider with custom URL', () => {
    const provider = createHttpProofProvider('http://custom:1234');
    expect(provider).toBeInstanceOf(HttpProofProvider);
  });
});
