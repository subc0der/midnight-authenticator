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
    // Handle Lace status check (may involve async operations)
    checkLaceStatus(message.requestId);
  }

  if (message.type === 'LACE_CALL') {
    // Handle Lace wallet method call
    handleLaceCall(message.requestId, message.method, message.args, message.networkId || 'preprod');
  }
});

/**
 * Check Lace wallet status and respond via postMessage.
 * Connects to wallet and gets configuration to verify availability.
 */
async function checkLaceStatus(requestId: string): Promise<void> {
  const midnight = (window as any).midnight;

  let laceAvailable = false;
  let proverUri: string | undefined;

  if (midnight && typeof midnight === 'object') {
    // Find Lace wallet by name (prefer 'lace' over other wallets)
    const wallets = Object.values(midnight) as any[];
    const laceWallet = wallets.find(w => w?.name === 'lace' && typeof w?.connect === 'function');

    if (laceWallet) {
      laceAvailable = true;
      // Try to connect and get configuration
      try {
        const connectedApi = await laceWallet.connect('preprod');
        if (connectedApi && typeof connectedApi.getConfiguration === 'function') {
          const config = await connectedApi.getConfiguration();
          proverUri = config?.proverServerUri;
        }
      } catch {
        // Wallet detected but couldn't connect - still mark as available
      }
    }
  }

  window.postMessage({
    type: 'LACE_STATUS_RESPONSE',
    source: `${PAGE_API_EXTENSION_ID}-page`,
    requestId,
    laceAvailable,
    proverUri,
  }, window.location.origin);
}

// Cache for connected Lace wallet APIs (keyed by networkId)
const connectedWalletCache = new Map<string, { api: any; connectedAt: number }>();
const WALLET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Handle a Lace wallet method call from the content script.
 * This runs in page context, so it CAN access window.midnight.
 *
 * Lace v4.0.1 flow:
 * 1. Find wallet entry in window.midnight[uuid]
 * 2. Call wallet.connect(networkId) to get connected API
 * 3. Call the requested method on the connected API
 */
async function handleLaceCall(
  requestId: string,
  method: string,
  args: unknown[],
  networkId: string
): Promise<void> {
  const sendResponse = (success: boolean, result?: unknown, error?: string) => {
    window.postMessage({
      type: 'LACE_RESPONSE',
      source: `${PAGE_API_EXTENSION_ID}-page`,
      requestId,
      success,
      result,
      error,
    }, window.location.origin);
  };

  try {
    const midnight = (window as any).midnight;

    if (!midnight || typeof midnight !== 'object') {
      sendResponse(false, undefined, 'Lace wallet not available (window.midnight not found)');
      return;
    }

    // Find Lace wallet by name (prefer 'lace' over other wallets like '1am')
    let walletEntry: any = null;
    const wallets = Object.values(midnight);
    // First try to find Lace specifically
    walletEntry = wallets.find((w: any) => w?.name === 'lace' && typeof w?.connect === 'function');
    // Fall back to any wallet with connect method
    if (!walletEntry) {
      walletEntry = wallets.find((w: any) => typeof w?.connect === 'function');
    }

    if (!walletEntry) {
      sendResponse(false, undefined, 'No Midnight wallet found in window.midnight');
      return;
    }

    // Check cache for connected API
    let connectedApi: any;
    const cached = connectedWalletCache.get(networkId);
    if (cached && Date.now() - cached.connectedAt < WALLET_CACHE_TTL_MS) {
      connectedApi = cached.api;
    } else {
      // Connect to get the full API
      console.log(`[PageAPI] Connecting to Lace wallet on ${networkId}...`);
      connectedApi = await walletEntry.connect(networkId);
      connectedWalletCache.set(networkId, { api: connectedApi, connectedAt: Date.now() });
      console.log('[PageAPI] Connected to Lace wallet');
    }

    if (!connectedApi) {
      sendResponse(false, undefined, `Failed to connect to Lace wallet on ${networkId}`);
      return;
    }

    // Get the method from connected API
    const fn = connectedApi[method];
    if (typeof fn !== 'function') {
      sendResponse(false, undefined, `Method '${method}' not found on connected Lace API`);
      return;
    }

    // Call the method
    console.log(`[PageAPI] Calling Lace method: ${method}`, args);
    const result = await fn.apply(connectedApi, args);
    console.log(`[PageAPI] Lace method ${method} returned:`, result);

    sendResponse(true, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[PageAPI] Lace method ${method} failed:`, error);
    // Clear cache on error (connection may have failed)
    connectedWalletCache.delete(networkId);
    sendResponse(false, undefined, message);
  }
}

console.log('[PageAPI] window.midnightAuth is available');

} // end if not already initialized
