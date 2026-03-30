/**
 * Lace Wallet Bridge
 *
 * Type-safe interface for calling Lace wallet methods from the background
 * service worker via content script messaging.
 *
 * Lace v4.0.1 API structure:
 * - window.midnight[uuid] = { apiVersion, name, connect(networkId) }
 * - connect('preprod') returns the full wallet API
 *
 * Flow:
 *   Background SW → chrome.tabs.sendMessage(LACE_CALL) → Content Script
 *   Content Script → window.postMessage → Page Context
 *   Page Context → window.midnight[uuid].connect() → ConnectedAPI
 *   Page Context → ConnectedAPI[method]() → Result
 *   Page Context → window.postMessage → Content Script
 *   Content Script → sendResponse → Background SW
 */

/**
 * Lace wallet configuration (from getConfiguration()).
 */
export interface LaceServiceConfig {
  networkId: string;
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri: string;
  substrateNodeUri: string;
}

/**
 * Lace connected wallet API methods (returned by connect()).
 */
export interface LaceConnectedAPI {
  getConfiguration(): Promise<LaceServiceConfig>;
  getUnshieldedBalances(): Promise<unknown>;
  getShieldedBalances(): Promise<unknown>;
  getDustBalance(): Promise<unknown>;
  getShieldedAddresses(): Promise<string[]>;
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
}

/**
 * Methods available on the initial wallet object (before connect).
 */
export interface LaceWalletEntry {
  apiVersion: string;
  name: string;
  icon: string;
  rdns: string;
  connect(networkId: string): Promise<LaceConnectedAPI>;
}

/**
 * Message sent to content script to call a Lace method.
 */
export interface LaceCallMessage {
  type: 'LACE_CALL';
  method: string;
  args: unknown[];
  requestId: string;
  networkId?: string;
}

/**
 * Response from content script after Lace call.
 */
export interface LaceCallResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// Timeout for Lace operations (proof generation can be slow)
const LACE_CALL_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Generate a unique request ID.
 */
function generateRequestId(): string {
  return `lace-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Default network for Lace connection
const LACE_NETWORK_ID = 'preprod';

/**
 * Call a Lace wallet method via content script messaging.
 *
 * The page context will:
 * 1. Find the wallet in window.midnight[uuid]
 * 2. Call connect(networkId) to get the connected API
 * 3. Call the requested method on the connected API
 *
 * @param method - The Lace wallet method to call (on connected API)
 * @param args - Arguments to pass to the method
 * @param networkId - Network to connect to (default: preprod)
 * @returns The result of the Lace method call
 * @throws Error if Lace is not available, method fails, or timeout occurs
 */
export async function callLaceMethod<T>(
  method: string,
  args: unknown[] = [],
  networkId: string = LACE_NETWORK_ID
): Promise<T> {
  const requestId = generateRequestId();

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active tab available for Lace communication');
  }

  // Don't try to call Lace on chrome:// or extension pages
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    throw new Error('Lace wallet not available on this page');
  }

  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Lace ${method}() timed out after ${LACE_CALL_TIMEOUT_MS / 1000}s`));
    }, LACE_CALL_TIMEOUT_MS);
  });

  // Send message to content script
  const messagePromise = chrome.tabs.sendMessage(tab.id, {
    type: 'LACE_CALL',
    method,
    args,
    requestId,
    networkId,
  } as LaceCallMessage);

  // Race between response and timeout
  const response = (await Promise.race([messagePromise, timeoutPromise])) as LaceCallResponse;

  if (!response) {
    throw new Error('No response from content script - Lace may not be available');
  }

  if (!response.success) {
    throw new Error(response.error || `Lace ${method}() failed`);
  }

  return response.result as T;
}

/**
 * Check if Lace wallet is available on the current page.
 * Returns true if window.midnight is detected.
 */
export async function isLaceDetected(): Promise<boolean> {
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
      type: 'CHECK_LACE_AVAILABLE',
    });

    return response?.laceAvailable ?? false;
  } catch {
    return false;
  }
}

/**
 * Get Lace wallet service configuration.
 * Returns the prover URI and other network endpoints.
 */
export async function getLaceServiceConfig(): Promise<LaceServiceConfig | null> {
  try {
    return await callLaceMethod<LaceServiceConfig>('getConfiguration');
  } catch {
    return null;
  }
}

/**
 * Lace wallet address info.
 */
export interface LaceWalletAddress {
  unshieldedAddress: string;
  dustAddress: string;
}

/**
 * Get Lace wallet addresses.
 */
export async function getLaceWalletAddress(): Promise<LaceWalletAddress | null> {
  try {
    const [unshieldedAddress, dustAddress] = await Promise.all([
      callLaceMethod<string>('getUnshieldedAddress'),
      callLaceMethod<string>('getDustAddress'),
    ]);
    return { unshieldedAddress, dustAddress };
  } catch {
    return null;
  }
}

/**
 * Connect to Lace wallet.
 * This is called implicitly by callLaceMethod, but can be called explicitly.
 */
export async function connectLaceWallet(networkId: string = LACE_NETWORK_ID): Promise<void> {
  // Connection happens implicitly when calling any method
  // Just verify we can get config to confirm connection works
  await callLaceMethod('getConfiguration', [], networkId);
}

/**
 * Balance a sealed transaction using Lace.
 * Lace will handle proof generation internally.
 *
 * @param unbalancedTx - The unbalanced transaction from contract.circuits.X()
 * @returns The balanced transaction (with proof)
 */
export async function balanceSealedTransaction(unbalancedTx: unknown): Promise<unknown> {
  return callLaceMethod('balanceSealedTransaction', [unbalancedTx]);
}

/**
 * Balance an unsealed transaction using Lace.
 *
 * @param unbalancedTx - The unbalanced transaction
 * @returns The balanced transaction
 */
export async function balanceUnsealedTransaction(unbalancedTx: unknown): Promise<unknown> {
  return callLaceMethod('balanceUnsealedTransaction', [unbalancedTx]);
}

/**
 * Submit a transaction to the Midnight network via Lace.
 *
 * @param balancedTx - The balanced and proved transaction
 * @returns The transaction hash
 */
export async function submitTransaction(balancedTx: unknown): Promise<string> {
  return callLaceMethod<string>('submitTransaction', [balancedTx]);
}
