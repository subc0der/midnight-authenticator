/**
 * Page API - Injected into page context
 * Provides window.midnightAuth API for dApps
 */

// Prevent double initialization
if ((window as any).__midnightAuthInitialized) {
  console.log('[PageAPI] Already initialized, skipping');
} else {
(window as any).__midnightAuthInitialized = true;

const PAGE_API_EXTENSION_ID = 'midnight-authenticator';

interface AuthRequest {
  accountId: string;
  challenge?: string;
}

interface AuthResult {
  success: boolean;
  proof?: number[];
  publicInputs?: {
    accountId: number[];
    nonce: string;
    expectedTimeWindow: string;
    result: boolean;
  };
  providerName?: string;
  isMock?: boolean;
  error?: string;
  pendingRequestId?: string;
}

interface ProofProviderResult {
  success: boolean;
  provider?: string;
  description?: string;
  error?: string;
}

interface ProofStatusResult {
  success: boolean;
  status?: {
    activeProvider: string | null;
    proofServerAvailable: boolean;
    laceAvailable: boolean;
    mockEnabled: boolean;
  };
  error?: string;
}

interface MidnightAuthAPI {
  requestAuth: (request: AuthRequest) => Promise<AuthResult>;
  getProofProvider: () => Promise<ProofProviderResult>;
  getProofStatus: () => Promise<ProofStatusResult>;
  isAvailable: () => boolean;
  // Note: getAccounts() intentionally not exposed to dApps for privacy.
  // Users select accounts in the extension popup during requestAuth flow.
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Wait for a pending auth request to be completed (after user unlocks and approves).
 */
function waitForAuthCompletion(pendingRequestId: string): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    function handleCompletion(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;

      const message = event.data;
      if (!message || message.source !== PAGE_API_EXTENSION_ID) return;
      if (message.type !== 'AUTH_REQUEST_COMPLETED') return;
      if (message.requestId !== pendingRequestId) return;

      window.removeEventListener('message', handleCompletion);

      const payload = message.payload as AuthResult;
      if (payload?.success === false) {
        reject(new Error(payload.error || 'Authentication denied'));
      } else {
        resolve(payload);
      }
    }

    window.addEventListener('message', handleCompletion);

    // Timeout after 5 minutes (for user to unlock and approve)
    setTimeout(() => {
      window.removeEventListener('message', handleCompletion);
      reject(new Error('Request timed out waiting for user approval'));
    }, 5 * 60 * 1000);
  });
}

function sendRequest<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = generateRequestId();

    function handleResponse(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;

      const message = event.data;
      if (!message || message.source !== PAGE_API_EXTENSION_ID) return;
      if (message.type !== `${type}_RESPONSE`) return;
      if (message.requestId !== requestId) return;

      window.removeEventListener('message', handleResponse);

      // Special case: pendingRequestId means the request is waiting for user action
      // Don't reject, let the caller handle it
      if (message.payload?.pendingRequestId) {
        resolve(message.payload as T);
      } else if (message.payload?.success === false) {
        reject(new Error(message.payload.error || 'Request failed'));
      } else {
        resolve(message.payload as T);
      }
    }

    window.addEventListener('message', handleResponse);

    window.postMessage({
      type,
      source: `${PAGE_API_EXTENSION_ID}-dapp`,
      requestId,
      payload,
    }, window.location.origin);

    // Timeout after 5 minutes (for user approval flows)
    setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      reject(new Error('Request timed out'));
    }, 5 * 60 * 1000);
  });
}

const midnightAuth: MidnightAuthAPI = {
  async requestAuth(request: AuthRequest): Promise<AuthResult> {
    const result = await sendRequest<AuthResult>('AUTH_REQUEST', { ...request });

    // If vault is locked, the request is pending user approval
    // Wait for AUTH_REQUEST_COMPLETED message
    if (result.pendingRequestId) {
      console.log('[PageAPI] Auth request pending, waiting for user approval...');
      return waitForAuthCompletion(result.pendingRequestId);
    }

    return result;
  },

  async getProofProvider(): Promise<ProofProviderResult> {
    return sendRequest<ProofProviderResult>('GET_PROOF_PROVIDER');
  },

  async getProofStatus(): Promise<ProofStatusResult> {
    return sendRequest<ProofStatusResult>('GET_PROOF_STATUS');
  },

  isAvailable(): boolean {
    return true;
  },
};

// Expose to page
(window as unknown as { midnightAuth: MidnightAuthAPI }).midnightAuth = midnightAuth;

// Listen for Lace status check from content script
// This runs in page context so it CAN see window.midnight
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;

  const message = event.data;
  if (!message || message.source !== `${PAGE_API_EXTENSION_ID}-content`) return;

  if (message.type === 'CHECK_LACE_STATUS') {
    const midnight = (window as any).midnight;

    // Lace exposes wallets as UUID keys in window.midnight
    // Find the first available wallet API
    let laceAvailable = false;
    let proverUri: string | undefined;
    let walletApi: any = null;

    if (midnight && typeof midnight === 'object') {
      // Look for wallet APIs (they have UUID keys)
      for (const key of Object.keys(midnight)) {
        const api = midnight[key];
        if (api && typeof api === 'object') {
          // Check if it's a Midnight wallet API (has apiVersion, name, etc.)
          if (api.apiVersion || api.enable || api.state) {
            walletApi = api;
            laceAvailable = true;
            break;
          }
        }
      }

      // Try to get prover URI from the wallet
      if (walletApi) {
        try {
          // Different ways Lace might expose the config
          if (typeof walletApi.serviceUriConfig === 'function') {
            const config = walletApi.serviceUriConfig();
            proverUri = config?.proverServerUri;
          }
        } catch {
          // Ignore errors getting config
        }
      }
    }

    
    window.postMessage({
      type: 'LACE_STATUS_RESPONSE',
      source: `${PAGE_API_EXTENSION_ID}-page`,
      requestId: message.requestId,
      laceAvailable,
      proverUri,
    }, window.location.origin);
  }
});

console.log('[PageAPI] window.midnightAuth is available');

} // end if not already initialized
