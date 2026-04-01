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

// Wallet discovery:
// - 1AM: Fixed key at window.midnight['1am']
// - Lace: Random UUID keys, find by checking .name === 'lace'
// Priority: 1AM (server-side ProofStation) > Lace (local Docker proving)
const WALLET_PRIORITY = ['1am', 'lace'] as const;
type WalletName = (typeof WALLET_PRIORITY)[number];

// ─── Proof Generation Types ────────────────────────────────────────────────

interface ProofGenerationMessage {
  requestId: string;
  circuitBaseUrl: string;
  accountId: number[];
  secret: number[];
  blinder: number[];
  nonce: string;
  expectedTimeWindow: string;
  contractAddress: string;
  networkId: string;
}

// Listen for wallet status check from content script
// This runs in page context so it CAN see window.midnight
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;

  const message = event.data;
  if (!message || message.source !== `${PAGE_API_EXTENSION_ID}-content`) return;

  if (message.type === 'CHECK_WALLET_STATUS') {
    // Handle wallet status check (may involve async operations)
    checkWalletStatus(message.requestId);
  }

  if (message.type === 'WALLET_CALL') {
    // Handle wallet method call
    handleWalletCall(message.requestId, message.method, message.args, message.networkId || 'preprod');
  }

  if (message.type === 'WALLET_GENERATE_PROOF') {
    // Handle full proof generation flow
    handleWalletProofGeneration(message as unknown as ProofGenerationMessage);
  }
});

/**
 * Find the best available wallet based on priority.
 * Priority: 1AM (server-side ProofStation) > Lace (local Docker)
 *
 * Discovery patterns:
 * - 1AM: Fixed key at window.midnight['1am']
 * - Lace: Random UUID keys, find by .name === 'lace'
 *
 * TODO: Re-enable Lace discovery after 1AM integration is tested
 */
function findBestWallet(midnight: any): { wallet: any; name: WalletName | string } | null {
  if (!midnight || typeof midnight !== 'object') return null;

  // 1. Check for 1AM at its fixed key
  const oneAmWallet = midnight['1am'];
  if (oneAmWallet && typeof oneAmWallet.connect === 'function') {
    console.log(`[PageAPI] Found 1AM wallet at window.midnight['1am']`);
    return { wallet: oneAmWallet, name: '1am' };
  }

  // TEMPORARILY DISABLED: Lace wallet discovery
  // Re-enable after 1AM integration is fully tested
  // --------------------------------------------------
  // // 2. Check for Lace by iterating (uses random UUID keys)
  // for (const [key, value] of Object.entries(midnight)) {
  //   const wallet = value as any;
  //   if (wallet?.name === 'lace' && typeof wallet.connect === 'function') {
  //     console.log(`[PageAPI] Found Lace wallet at window.midnight['${key}']`);
  //     return { wallet, name: 'lace' };
  //   }
  // }
  //
  // // 3. Fallback: any wallet with connect method (future wallets)
  // for (const [key, value] of Object.entries(midnight)) {
  //   const wallet = value as any;
  //   if (wallet && typeof wallet.connect === 'function') {
  //     console.warn(`[PageAPI] Using unknown wallet '${wallet.name || key}' at window.midnight['${key}']`);
  //     return { wallet, name: wallet.name || key };
  //   }
  // }
  // --------------------------------------------------

  console.warn('[PageAPI] No 1AM wallet found. Install 1AM wallet from https://1am.xyz');
  return null;
}

/**
 * Check wallet status and respond via postMessage.
 * Connects to best available wallet and gets configuration.
 */
async function checkWalletStatus(requestId: string): Promise<void> {
  const midnight = (window as any).midnight;

  let walletAvailable = false;
  let walletName: string | undefined;
  let proverUri: string | undefined;

  const found = findBestWallet(midnight);
  if (found) {
    walletAvailable = true;
    walletName = found.name;

    // Try to connect and get configuration
    try {
      const connectedApi = await found.wallet.connect('preprod');
      if (connectedApi && typeof connectedApi.getConfiguration === 'function') {
        const config = await connectedApi.getConfiguration();
        proverUri = config?.proverServerUri;
      }
    } catch {
      // Wallet detected but couldn't connect - still mark as available
    }
  }

  window.postMessage({
    type: 'WALLET_STATUS_RESPONSE',
    source: `${PAGE_API_EXTENSION_ID}-page`,
    requestId,
    walletAvailable,
    walletName,
    proverUri,
  }, window.location.origin);
}

// Cache for connected wallet APIs (keyed by networkId:walletName)
// Using composite key ensures we reconnect if a different wallet becomes available
const connectedWalletCache = new Map<string, { api: any; walletName: string; connectedAt: number }>();
const WALLET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Handle a wallet method call from the content script.
 * This runs in page context, so it CAN access window.midnight.
 *
 * Wallet priority: 1AM (server-side proving) > Lace (local Docker)
 *
 * Flow:
 * 1. Find best wallet in window.midnight[uuid]
 * 2. Call wallet.connect(networkId) to get connected API
 * 3. Call the requested method on the connected API
 */
async function handleWalletCall(
  requestId: string,
  method: string,
  args: unknown[],
  networkId: string
): Promise<void> {
  const sendResponse = (success: boolean, result?: unknown, error?: string, walletName?: string) => {
    window.postMessage({
      type: 'WALLET_RESPONSE',
      source: `${PAGE_API_EXTENSION_ID}-page`,
      requestId,
      success,
      result,
      error,
      walletName,
    }, window.location.origin);
  };

  try {
    const midnight = (window as any).midnight;

    if (!midnight || typeof midnight !== 'object') {
      sendResponse(false, undefined, 'No Midnight wallet available (window.midnight not found)');
      return;
    }

    // Find best wallet using priority system
    const found = findBestWallet(midnight);
    if (!found) {
      sendResponse(false, undefined, 'No Midnight wallet found in window.midnight');
      return;
    }

    // Check cache for connected API (keyed by networkId:walletName)
    let connectedApi: any;
    const walletName = found.name;
    const cacheKey = `${networkId}:${walletName}`;
    const cached = connectedWalletCache.get(cacheKey);

    if (cached && Date.now() - cached.connectedAt < WALLET_CACHE_TTL_MS) {
      connectedApi = cached.api;
    } else {
      // Connect to get the full API
      console.log(`[PageAPI] Connecting to ${walletName} wallet on ${networkId}...`);
      connectedApi = await found.wallet.connect(networkId);
      connectedWalletCache.set(cacheKey, {
        api: connectedApi,
        walletName,
        connectedAt: Date.now(),
      });
      console.log(`[PageAPI] Connected to ${walletName} wallet`);
    }

    if (!connectedApi) {
      sendResponse(false, undefined, `Failed to connect to ${walletName} wallet on ${networkId}`, walletName);
      return;
    }

    // Security: Only allow specific wallet methods to prevent method injection
    const ALLOWED_METHODS = [
      'getConfiguration',
      'getUnshieldedAddress',
      'getDustAddress',
      'getShieldedAddresses',
      'balanceSealedTransaction',
      'balanceUnsealedTransaction',
      'submitTransaction',
      'getProvingProvider',
    ];

    if (!ALLOWED_METHODS.includes(method)) {
      sendResponse(false, undefined, `Method '${method}' is not allowed`, walletName);
      return;
    }

    // Get the method from connected API
    const fn = connectedApi[method];
    if (typeof fn !== 'function') {
      sendResponse(false, undefined, `Method '${method}' not found on ${walletName} wallet API`, walletName);
      return;
    }

    // Call the method
    console.log(`[PageAPI] Calling ${walletName} wallet method: ${method}`, args);
    const result = await fn.apply(connectedApi, args);
    console.log(`[PageAPI] ${walletName} wallet method ${method} returned:`, result);

    sendResponse(true, result, undefined, walletName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[PageAPI] Wallet method ${method} failed:`, error);
    // Clear all caches for this network on error (connection may have failed)
    for (const key of connectedWalletCache.keys()) {
      if (key.startsWith(`${networkId}:`)) {
        connectedWalletCache.delete(key);
      }
    }
    sendResponse(false, undefined, message);
  }
}

// ─── Full Proof Generation Handler ─────────────────────────────────────────

/**
 * Handle full ZK proof generation via wallet.
 *
 * Flow:
 * 1. Connect to wallet (1AM preferred)
 * 2. Create FetchZkConfigProvider from bundled circuit assets
 * 3. Get proving provider from wallet
 * 4. Build unproven transaction using contract
 * 5. Prove transaction
 * 6. Balance transaction
 * 7. Submit to network
 *
 * Note: This implementation assumes the wallet handles most of the complexity.
 * 1AM uses server-side ProofStation for proving, no Docker required.
 */
async function handleWalletProofGeneration(message: ProofGenerationMessage): Promise<void> {
  const sendResponse = (success: boolean, txHash?: string, error?: string, walletName?: string) => {
    window.postMessage({
      type: 'WALLET_PROOF_RESPONSE',
      source: `${PAGE_API_EXTENSION_ID}-page`,
      requestId: message.requestId,
      success,
      txHash,
      error,
      walletName,
    }, window.location.origin);
  };

  try {
    // Defense-in-depth: Validate circuit URL comes from our extension
    // The content script generates this via chrome.runtime.getURL(), but we verify anyway
    if (!message.circuitBaseUrl || !message.circuitBaseUrl.startsWith('chrome-extension://')) {
      sendResponse(false, undefined, 'Invalid circuit URL: must be extension protocol');
      return;
    }

    console.log('[PageAPI] Starting proof generation...');
    console.log('[PageAPI] Contract address:', message.contractAddress);
    console.log('[PageAPI] Network:', message.networkId);

    // 1. Find and connect wallet
    const midnight = (window as any).midnight;
    const found = findBestWallet(midnight);

    if (!found) {
      sendResponse(false, undefined, 'No 1AM wallet found. Install from https://1am.xyz');
      return;
    }

    console.log(`[PageAPI] Connecting to ${found.name} wallet...`);
    const connectedApi = await found.wallet.connect(message.networkId);

    if (!connectedApi) {
      sendResponse(false, undefined, `Failed to connect to ${found.name} wallet`, found.name);
      return;
    }

    console.log(`[PageAPI] Connected to ${found.name} wallet`);

    // 2. Get wallet configuration (for indexer URL, prover server, etc.)
    const config = await connectedApi.getConfiguration();
    console.log('[PageAPI] Wallet config:', config);

    // 3. Create ZK config provider
    // For 1AM, the wallet handles proving server-side via ProofStation
    // We still need to provide circuit asset URLs for the prover to fetch
    console.log('[PageAPI] Circuit base URL:', message.circuitBaseUrl);

    // The FetchZkConfigProvider would normally be used here:
    // const zkConfigProvider = new FetchZkConfigProvider(message.circuitBaseUrl, fetch.bind(window));

    // 4. Get proving provider from wallet
    // Note: For 1AM, this returns a provider that delegates to ProofStation
    console.log('[PageAPI] Getting proving provider from wallet...');

    // Try to get the proving provider
    // This may throw if the wallet doesn't support getProvingProvider
    let provingProvider: unknown;
    try {
      // Pass a simple config object - the wallet will use its own proving service
      provingProvider = await connectedApi.getProvingProvider({
        // Circuit assets URL - wallet may fetch these for proof generation
        circuitAssetsUrl: message.circuitBaseUrl,
        // Contract name for circuit lookup
        contractName: 'totp-verifier',
      });
      console.log('[PageAPI] Got proving provider');
    } catch (e) {
      console.error('[PageAPI] getProvingProvider failed:', e);
      // If getProvingProvider fails, we'll try a different approach
      // Some wallets may handle proving differently
    }

    // 5. Convert input arrays back to proper types
    const accountId = new Uint8Array(message.accountId);
    const secret = new Uint8Array(message.secret);
    const blinder = new Uint8Array(message.blinder);
    const nonce = BigInt(message.nonce);
    const expectedTimeWindow = BigInt(message.expectedTimeWindow);

    // Helper to clear sensitive buffers (called in finally block)
    const clearSecrets = () => {
      secret.fill(0);
      blinder.fill(0);
    };

    try {
      // 6. Build the authentication transaction
      // This is where we'd call the contract's authenticate circuit
      // The implementation depends on how the contract module is loaded

      // For now, we'll use a simpler approach:
      // Create the proof request data structure that the wallet can understand
      const authRequest = {
        circuit: 'authenticate',
        contractAddress: message.contractAddress,
        inputs: {
          accountId: Array.from(accountId),
          nonce: nonce.toString(),
          expectedTimeWindow: expectedTimeWindow.toString(),
        },
        witnesses: {
          secret: Array.from(secret),
          blinder: Array.from(blinder),
        },
      };

      console.log('[PageAPI] Auth request prepared (circuit: authenticate)');

      // TODO: Full SDK integration
      // The complete flow would be:
      // 1. Load contract module (bundled with extension)
      // 2. Join deployed contract using findDeployedContract()
      // 3. Call contract.callTx.authenticate(accountId, nonce, expectedTimeWindow)
      // 4. The SDK handles proving, balancing, and submission
      //
      // For now, we return an error indicating SDK integration is needed
      // This allows us to test the message flow end-to-end

      // Temporary: Return error until full SDK integration is complete
      sendResponse(
        false,
        undefined,
        'Proof generation not yet implemented. Wallet connected successfully to ' +
          `${found.name} on ${message.networkId}. ` +
          'Next: Bundle contract module for page context.',
        found.name
      );
    } finally {
      // Always zero out sensitive data, even on error
      clearSecrets();
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[PageAPI] Proof generation error:', error);
    sendResponse(false, undefined, errorMessage);
  }
}

console.log('[PageAPI] window.midnightAuth is available');

} // end if not already initialized
