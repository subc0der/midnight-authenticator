/**
 * Tests for ProofService
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProofService, getProofService, resetProofService } from '../service';
import type { ProofRequest, ProofResult } from '../types';

// Mock chrome APIs
const mockGetManifest = vi.fn();
const mockStorageGet = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    getManifest: mockGetManifest,
  },
  storage: {
    local: {
      get: mockStorageGet,
    },
  },
});

// Mock fetch for HTTP provider
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

describe('ProofService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default to development mode
    mockGetManifest.mockReturnValue({});
    // No preferred provider
    mockStorageGet.mockResolvedValue({});
    // HTTP provider not available by default
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    // Reset singleton
    resetProofService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const service = new ProofService();
      expect(service).toBeInstanceOf(ProofService);
    });

    it('should merge custom config with defaults', () => {
      const service = new ProofService({
        proofServerUrl: 'http://custom:1234',
        timeoutMs: 30000,
      });
      expect(service).toBeInstanceOf(ProofService);
    });

    it('should include mock provider when allowMockProofs is true', async () => {
      const service = new ProofService({ allowMockProofs: true });
      const provider = await service.getAvailableProvider();
      // In dev mode, mock should be available
      expect(provider).toBe('mock');
    });

    it('should exclude mock provider when allowMockProofs is false', async () => {
      const service = new ProofService({ allowMockProofs: false });
      const provider = await service.getAvailableProvider();
      // No providers available (Lace not installed, HTTP not running)
      expect(provider).toBeNull();
    });
  });

  describe('generateProof', () => {
    it('should use mock provider in development mode', async () => {
      const service = new ProofService({ allowMockProofs: true });
      const request = createValidRequest();

      const resultPromise = service.generateProof(request);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.providerName).toBe('mock');
      expect(result.isMock).toBe(true);
    });

    it('should return error when no provider available', async () => {
      // Production mode, no providers
      mockGetManifest.mockReturnValue({ update_url: 'https://example.com' });
      const service = new ProofService({ allowMockProofs: false });
      const request = createValidRequest();

      const result = await service.generateProof(request);

      expect(result.success).toBe(false);
      expect(result.providerName).toBe('none');
      expect(result.error).toContain('No proof provider available');
    });

    it('should include helpful error message in development', async () => {
      mockGetManifest.mockReturnValue({});
      const service = new ProofService({ allowMockProofs: false });
      const request = createValidRequest();

      const result = await service.generateProof(request);

      expect(result.error).toContain('Install Lace wallet');
      expect(result.error).toContain('docker');
      expect(result.error).toContain('Mock provider');
    });

    it('should include helpful error message in production', async () => {
      mockGetManifest.mockReturnValue({ update_url: 'https://example.com' });
      const service = new ProofService({ allowMockProofs: false });
      const request = createValidRequest();

      const result = await service.generateProof(request);

      expect(result.error).toContain('Lace wallet');
      expect(result.error).not.toContain('Mock provider');
    });

    describe('timeout handling', () => {
      it('should timeout slow proof generation', async () => {
        const service = new ProofService({
          timeoutMs: 1000, // 1 second timeout
          allowMockProofs: true,
        });
        const request = createValidRequest();

        const resultPromise = service.generateProof(request);

        // Mock provider takes 2 seconds, but timeout is 1 second
        await vi.advanceTimersByTimeAsync(1000);
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
        expect(result.error).toContain('1 seconds');
      });

      it('should complete before timeout if fast enough', async () => {
        const service = new ProofService({
          timeoutMs: 5000, // 5 second timeout
          allowMockProofs: true,
        });
        const request = createValidRequest();

        const resultPromise = service.generateProof(request);

        // Mock provider takes 2 seconds
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(true);
      });
    });

    describe('preferred provider', () => {
      it('should use preferred provider if available', async () => {
        mockStorageGet.mockResolvedValue({ preferredProofProvider: 'mock' });
        const service = new ProofService({ allowMockProofs: true });
        const request = createValidRequest();

        const resultPromise = service.generateProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.success).toBe(true);
        expect(result.providerName).toBe('mock');
      });

      it('should fall back if preferred provider not available', async () => {
        // Prefer HTTP, but it's not running
        mockStorageGet.mockResolvedValue({ preferredProofProvider: 'http' });
        mockFetch.mockRejectedValue(new Error('Connection refused'));

        const service = new ProofService({ allowMockProofs: true });
        const request = createValidRequest();

        const resultPromise = service.generateProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        // Should fall back to mock
        expect(result.success).toBe(true);
        expect(result.providerName).toBe('mock');
      });

      it('should ignore unknown preferred provider', async () => {
        mockStorageGet.mockResolvedValue({ preferredProofProvider: 'unknown' });
        const service = new ProofService({ allowMockProofs: true });
        const request = createValidRequest();

        const resultPromise = service.generateProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        // Should use first available (mock in dev)
        expect(result.success).toBe(true);
      });
    });

    describe('error handling', () => {
      it('should catch and wrap provider errors', async () => {
        // Create a service where mock throws
        mockGetManifest.mockImplementation(() => {
          throw new Error('Manifest error');
        });

        const service = new ProofService({ allowMockProofs: true });
        const request = createValidRequest();

        const resultPromise = service.generateProof(request);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        // Mock should still work (isDevelopment returns true on error)
        expect(result.success).toBe(true);
      });
    });
  });

  describe('getAvailableProvider', () => {
    it('should return mock in development mode', async () => {
      mockGetManifest.mockReturnValue({});
      const service = new ProofService({ allowMockProofs: true });

      const provider = await service.getAvailableProvider();

      expect(provider).toBe('mock');
    });

    it('should return null when no provider available', async () => {
      mockGetManifest.mockReturnValue({ update_url: 'https://example.com' });
      const service = new ProofService({ allowMockProofs: false });

      const provider = await service.getAvailableProvider();

      expect(provider).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('should return status with mock enabled in development', async () => {
      mockGetManifest.mockReturnValue({});
      const service = new ProofService({ allowMockProofs: true });

      const status = await service.getStatus();

      expect(status.mockEnabled).toBe(true);
      expect(status.activeProvider).toBe('mock');
    });

    it('should show proof server unavailable when not running', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const service = new ProofService({ allowMockProofs: true });

      const status = await service.getStatus();

      expect(status.proofServerAvailable).toBe(false);
    });

    it('should show Lace unavailable when not installed', async () => {
      const service = new ProofService({ allowMockProofs: true });

      const status = await service.getStatus();

      expect(status.laceAvailable).toBe(false);
    });
  });

  describe('getProviderDescription', () => {
    it('should return friendly name for lace', () => {
      const service = new ProofService();
      expect(service.getProviderDescription('lace')).toBe('Lace Wallet');
    });

    it('should return friendly name for http', () => {
      const service = new ProofService();
      expect(service.getProviderDescription('http')).toBe('Local Proof Server (Docker)');
    });

    it('should return friendly name for mock', () => {
      const service = new ProofService();
      expect(service.getProviderDescription('mock')).toBe('Mock (Development Only)');
    });

    it('should return raw name for unknown provider', () => {
      const service = new ProofService();
      expect(service.getProviderDescription('unknown')).toBe('unknown');
    });
  });
});

describe('getProofService singleton', () => {
  beforeEach(() => {
    resetProofService();
    mockGetManifest.mockReturnValue({});
    mockStorageGet.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return same instance on multiple calls', () => {
    const service1 = getProofService();
    const service2 = getProofService();

    expect(service1).toBe(service2);
  });

  it('should create new instance after reset', () => {
    const service1 = getProofService();
    resetProofService();
    const service2 = getProofService();

    expect(service1).not.toBe(service2);
  });

  it('should use config from first call', () => {
    const service1 = getProofService({ timeoutMs: 5000 });
    const service2 = getProofService({ timeoutMs: 10000 }); // Ignored

    expect(service1).toBe(service2);
  });
});
