/**
 * Midnight Wallet Bridge
 *
 * Type-safe interface for calling Midnight wallet methods from the background
 * service worker via content script messaging.
 *
 * Supports multiple wallets via the DApp Connector API v4:
 * - 1AM (preferred): Server-side proving via ProofStation, no Docker required
 * - Lace: Local proving via Docker proof server
 *
 * Wallet discovery in window.midnight:
 * - 1AM: Fixed key at window.midnight['1am']
 * - Lace: Random UUID keys, found by checking .name === 'lace'
 *
 * Flow:
 *   Background SW → chrome.tabs.sendMessage(WALLET_CALL) → Content Script
 *   Content Script → window.postMessage → Page Context
 *   Page Context → findBestWallet() discovers wallet
 *   Page Context → wallet.connect('preprod') → ConnectedAPI
 *   Page Context → ConnectedAPI[method]() → Result
 *   Page Context → window.postMessage → Content Script
 *   Content Script → sendResponse → Background SW
 */

/**
 * Wallet configuration (from getConfiguration()).
 */
export interface WalletServiceConfig {
  networkId: string;
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri: string;
  substrateNodeUri: string;
}

/**
 * Connected wallet API methods (returned by connect()).
 * Both 1AM and Lace implement this interface.
 */
export interface WalletConnectedAPI {
  getConfiguration(): Promise<WalletServiceConfig>;
  getUnshieldedBalances(): Promise<unknown>;
  getShieldedBalances(): Promise<unknown>;
  getDustBalance(): Promise<unknown>;
  getShieldedAddresses(): Promise<{ shieldedCoinPublicKey: string; shieldedEncryptionPublicKey: string }>;
  getUnshieldedAddress(): Promise<string>;
  getDustAddress(): Promise<string>;
  getConnectionStatus(): Promise<unknown>;
  getTxHistory(): Promise<unknown>;
  balanceSealedTransaction(tx: unknown): Promise<unknown>;
  balanceUnsealedTransaction(tx: unknown): Promise<unknown>;
  submitTransaction(tx: unknown): Promise<string>;
  signData(data: unknown): Promise<unknown>;
  makeIntent(intent: unknown): Promise<unknown>;
  makeTransfer(transfer: unknown): Promise<unknown>;
  // Key method for ZK proof generation
  getProvingProvider(zkConfigProvider: unknown): Promise<unknown>;
}

/**
 * Methods available on the initial wallet object (before connect).
 * Based on Midnight DApp Connector API v4.
 */
export interface WalletEntry {
  apiVersion: string;
  name: string;
  icon: string;
  rdns?: string; // Reverse domain name (metadata, not used for security)
  connect(networkId: string): Promise<WalletConnectedAPI>;
}

/**
 * Supported wallet names in priority order.
 * 1AM is preferred because it offers server-side proving via ProofStation (no Docker required).
 *
 * Discovery patterns:
 * - 1AM: Fixed key at window.midnight['1am']
 * - Lace: Random UUID keys, find by .name === 'lace'
 */
export const WALLET_PRIORITY = ['1am', 'lace'] as const;
export type WalletName = (typeof WALLET_PRIORITY)[number];

/**
 * Message sent to content script to call a wallet method.
 */
export interface WalletCallMessage {
  type: 'WALLET_CALL';
  method: string;
  args: unknown[];
  requestId: string;
  networkId?: string;
}

/**
 * Response from content script after wallet call.
 */
export interface WalletCallResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  walletName?: string;
}

// Timeout for wallet operations (proof generation can be slow)
const WALLET_CALL_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Generate a unique request ID.
 */
function generateRequestId(): string {
  return `wallet-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Default network for wallet connection
const DEFAULT_NETWORK_ID = 'preprod';

/**
 * Call a Midnight wallet method via content script messaging.
 *
 * The page context will:
 * 1. Find wallets in window.midnight[uuid]
 * 2. Select the best wallet (prefer 1AM, fallback to Lace)
 * 3. Call connect(networkId) to get the connected API
 * 4. Call the requested method on the connected API
 *
 * @param method - The wallet method to call (on connected API)
 * @param args - Arguments to pass to the method
 * @param networkId - Network to connect to (default: preprod)
 * @returns The result of the wallet method call
 * @throws Error if no wallet available, method fails, or timeout occurs
 */
export async function callWalletMethod<T>(
  method: string,
  args: unknown[] = [],
  networkId: string = DEFAULT_NETWORK_ID
): Promise<T> {
  const requestId = generateRequestId();

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active tab available for wallet communication');
  }

  // Don't try to call wallet on chrome:// or extension pages
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    throw new Error('Midnight wallet not available on this page');
  }

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Wallet ${method}() timed out after ${WALLET_CALL_TIMEOUT_MS / 1000}s`));
    }, WALLET_CALL_TIMEOUT_MS);
  });

  // Send message to content script
  const messagePromise = chrome.tabs.sendMessage(tab.id, {
    type: 'WALLET_CALL',
    method,
    args,
    requestId,
    networkId,
  } as WalletCallMessage);

  // Race between response and timeout
  const response = (await Promise.race([messagePromise, timeoutPromise])) as WalletCallResponse;

  if (!response) {
    throw new Error('No response from content script - wallet may not be available');
  }

  if (!response.success) {
    throw new Error(response.error || `Wallet ${method}() failed`);
  }

  return response.result as T;
}

/**
 * Check if a Midnight wallet is available on the current page.
 * Returns wallet info if detected.
 */
export async function isWalletDetected(): Promise<boolean> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url) {
      return false;
    }

    // Don't check on chrome:// or extension pages
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return false;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'CHECK_WALLET_AVAILABLE',
    });

    return response?.walletAvailable ?? false;
  } catch {
    return false;
  }
}

/**
 * Get wallet service configuration.
 * Returns the prover URI and other network endpoints.
 */
export async function getWalletServiceConfig(): Promise<WalletServiceConfig | null> {
  try {
    return await callWalletMethod<WalletServiceConfig>('getConfiguration');
  } catch {
    return null;
  }
}

/**
 * Wallet address info.
 */
export interface WalletAddressInfo {
  unshieldedAddress: string;
  dustAddress: string;
}

/**
 * Get wallet addresses.
 */
export async function getWalletAddress(): Promise<WalletAddressInfo | null> {
  try {
    const [unshieldedAddress, dustAddress] = await Promise.all([
      callWalletMethod<string>('getUnshieldedAddress'),
      callWalletMethod<string>('getDustAddress'),
    ]);
    return { unshieldedAddress, dustAddress };
  } catch {
    return null;
  }
}

/**
 * Connect to wallet.
 * This is called implicitly by callWalletMethod, but can be called explicitly.
 */
export async function connectWallet(networkId: string = DEFAULT_NETWORK_ID): Promise<void> {
  // Connection happens implicitly when calling any method
  // Just verify we can get config to confirm connection works
  await callWalletMethod('getConfiguration', [], networkId);
}

/**
 * Balance a sealed transaction using the wallet.
 * Wallet will handle proof generation internally.
 *
 * @param unbalancedTx - The unbalanced transaction from contract.circuits.X()
 * @returns The balanced transaction (with proof)
 */
export async function balanceSealedTransaction(unbalancedTx: unknown): Promise<unknown> {
  return callWalletMethod('balanceSealedTransaction', [unbalancedTx]);
}

/**
 * Balance an unsealed transaction using the wallet.
 *
 * @param unbalancedTx - The unbalanced transaction
 * @returns The balanced transaction
 */
export async function balanceUnsealedTransaction(unbalancedTx: unknown): Promise<unknown> {
  return callWalletMethod('balanceUnsealedTransaction', [unbalancedTx]);
}

/**
 * Submit a transaction to the Midnight network via wallet.
 *
 * @param balancedTx - The balanced and proved transaction
 * @returns The transaction hash
 */
export async function submitTransaction(balancedTx: unknown): Promise<string> {
  return callWalletMethod<string>('submitTransaction', [balancedTx]);
}

/**
 * Get the proving provider from the wallet.
 * This is the key method for ZK proof generation.
 *
 * @param zkConfigProvider - The ZK config provider (e.g., BrowserZkConfigProvider)
 * @returns The proving provider interface
 */
export async function getProvingProvider(zkConfigProvider: unknown): Promise<unknown> {
  return callWalletMethod('getProvingProvider', [zkConfigProvider]);
}

// ─── Full Proof Generation ─────────────────────────────────────────────────

/**
 * Request for generating a ZK authentication proof via wallet.
 */
export interface WalletProofRequest {
  accountId: Uint8Array;
  secret: Uint8Array;
  blinder: Uint8Array;
  nonce: bigint;
  expectedTimeWindow: bigint;
  contractAddress: string;
  networkId: string;
}

/**
 * Result from wallet proof generation.
 */
export interface WalletProofResult {
  success: boolean;
  txHash?: string;
  error?: string;
  walletName?: string;
}

// Extended timeout for proof generation (can take 30+ seconds on 1AM ProofStation)
const PROOF_GENERATION_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Generate a ZK authentication proof via the wallet.
 *
 * This sends the full proof generation request to page context where:
 * 1. Wallet is connected
 * 2. ZK config provider is created from bundled circuit assets
 * 3. Proving provider is obtained from wallet
 * 4. Transaction is built, proved, balanced, and submitted
 *
 * @param request - The proof generation request
 * @returns The result including transaction hash on success
 */
export async function generateWalletProof(request: WalletProofRequest): Promise<WalletProofResult> {
  const requestId = generateRequestId();

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    return {
      success: false,
      error: 'No active tab available for wallet communication',
    };
  }

  // Don't try on chrome:// or extension pages
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    return {
      success: false,
      error: 'Midnight wallet not available on this page',
    };
  }

  // Create timeout promise
  const timeoutPromise = new Promise<WalletProofResult>((resolve) => {
    setTimeout(() => {
      resolve({
        success: false,
        error: `Proof generation timed out after ${PROOF_GENERATION_TIMEOUT_MS / 1000}s`,
      });
    }, PROOF_GENERATION_TIMEOUT_MS);
  });

  // Send proof generation request to content script
  const messagePromise = chrome.tabs.sendMessage(tab.id, {
    type: 'WALLET_GENERATE_PROOF',
    requestId,
    payload: {
      accountId: Array.from(request.accountId),
      secret: Array.from(request.secret),
      blinder: Array.from(request.blinder),
      nonce: request.nonce.toString(),
      expectedTimeWindow: request.expectedTimeWindow.toString(),
      contractAddress: request.contractAddress,
      networkId: request.networkId,
    },
  });

  // Race between response and timeout
  try {
    const response = await Promise.race([messagePromise, timeoutPromise]);

    if (!response) {
      return {
        success: false,
        error: 'No response from content script - wallet may not be available',
      };
    }

    return response as WalletProofResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Legacy exports for backward compatibility during migration
export {
  isWalletDetected as isLaceDetected,
  getWalletServiceConfig as getLaceServiceConfig,
  callWalletMethod as callLaceMethod,
};
export type { WalletServiceConfig as LaceServiceConfig };
