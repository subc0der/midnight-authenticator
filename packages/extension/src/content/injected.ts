/**
 * Content Script - Bridge between page and extension
 *
 * Security:
 * - Whitelists allowed message types
 * - Uses sender.origin for trust
 * - Spreads payload BEFORE setting type to prevent override attacks
 */

const INJECTED_EXTENSION_ID = 'midnight-authenticator';
// SECURITY: Only safe message types are allowed from dApps.
// Proof-related operations that don't expose secrets are safe.
// GET_ACCOUNTS removed - was a privacy leak (any site could enumerate user's accounts)
// Security fix: Prevents privacy leak where any site could enumerate user accounts
const ALLOWED_MESSAGE_TYPES = [
  'AUTH_REQUEST',       // Requires popup approval
  'REGISTER_ACCOUNT',   // Requires popup approval
  'GET_PROOF_PROVIDER', // Safe - only returns provider name
  'GET_PROOF_STATUS',   // Safe - returns availability status
] as const;

type AllowedMessageType = typeof ALLOWED_MESSAGE_TYPES[number];

// Pending wallet check requests (waiting for page context response)
const pendingWalletChecks = new Map<string, (response: { walletAvailable: boolean; walletName?: string; proverUri?: string }) => void>();

// Pending wallet method calls (waiting for page context response)
const pendingWalletCalls = new Map<string, (response: { success: boolean; result?: unknown; error?: string; walletName?: string }) => void>();

// Listen for wallet status from page context
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;

  const message = event.data;
  if (!message || message.source !== `${INJECTED_EXTENSION_ID}-page`) return;

  if (message.type === 'WALLET_STATUS_RESPONSE') {
    const callback = pendingWalletChecks.get(message.requestId);
    if (callback) {
      pendingWalletChecks.delete(message.requestId);
      callback({
        walletAvailable: message.walletAvailable,
        walletName: message.walletName,
        proverUri: message.proverUri,
      });
    }
  }

  // Handle wallet method call response from page context
  if (message.type === 'WALLET_RESPONSE') {
    const callback = pendingWalletCalls.get(message.requestId);
    if (callback) {
      pendingWalletCalls.delete(message.requestId);
      callback({
        success: message.success,
        result: message.result,
        error: message.error,
        walletName: message.walletName,
      });
    }
  }
});

// Listen for messages from background (for wallet detection and auth completion)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle wallet availability check (new unified message)
  if (message.type === 'CHECK_WALLET_AVAILABLE') {
    const requestId = `wallet-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timeoutId = setTimeout(() => {
      pendingWalletChecks.delete(requestId);
      sendResponse({ walletAvailable: false });
    }, 1000);

    pendingWalletChecks.set(requestId, (response) => {
      clearTimeout(timeoutId);
      sendResponse(response);
    });

    window.postMessage({
      type: 'CHECK_WALLET_STATUS',
      source: `${INJECTED_EXTENSION_ID}-content`,
      requestId,
    }, window.location.origin);

    return true;
  }

  // Legacy: CHECK_LACE_AVAILABLE (backward compatibility)
  if (message.type === 'CHECK_LACE_AVAILABLE') {
    const requestId = `wallet-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timeoutId = setTimeout(() => {
      pendingWalletChecks.delete(requestId);
      sendResponse({ laceAvailable: false });
    }, 1000);

    pendingWalletChecks.set(requestId, (response) => {
      clearTimeout(timeoutId);
      // Map new response format to legacy format
      sendResponse({
        laceAvailable: response.walletAvailable,
        proverUri: response.proverUri,
      });
    });

    window.postMessage({
      type: 'CHECK_WALLET_STATUS',
      source: `${INJECTED_EXTENSION_ID}-content`,
      requestId,
    }, window.location.origin);

    return true;
  }

  // Handle wallet method calls from background (new unified message)
  if (message.type === 'WALLET_CALL') {
    const { method, args, requestId, networkId } = message;

    const timeoutId = setTimeout(() => {
      pendingWalletCalls.delete(requestId);
      sendResponse({ success: false, error: 'Wallet call timed out' });
    }, 60_000);

    pendingWalletCalls.set(requestId, (response) => {
      clearTimeout(timeoutId);
      sendResponse(response);
    });

    window.postMessage({
      type: 'WALLET_CALL',
      source: `${INJECTED_EXTENSION_ID}-content`,
      requestId,
      method,
      args,
      networkId: networkId || 'preprod',
    }, window.location.origin);

    return true;
  }

  // Legacy: LACE_CALL (backward compatibility)
  if (message.type === 'LACE_CALL') {
    const { method, args, requestId, networkId } = message;

    const timeoutId = setTimeout(() => {
      pendingWalletCalls.delete(requestId);
      sendResponse({ success: false, error: 'Wallet call timed out' });
    }, 60_000);

    pendingWalletCalls.set(requestId, (response) => {
      clearTimeout(timeoutId);
      sendResponse(response);
    });

    window.postMessage({
      type: 'WALLET_CALL',
      source: `${INJECTED_EXTENSION_ID}-content`,
      requestId,
      method,
      args,
      networkId: networkId || 'preprod',
    }, window.location.origin);

    return true;
  }

  // Relay auth completion from background to page
  if (message.type === 'AUTH_REQUEST_COMPLETED') {
    window.postMessage({
      type: 'AUTH_REQUEST_COMPLETED',
      source: INJECTED_EXTENSION_ID,
      requestId: message.requestId,
      payload: message.result,
    }, window.location.origin);
    sendResponse({ received: true });
    return true;
  }

  return false;
});

// Listen for messages from page
window.addEventListener('message', async (event) => {
  // Only accept messages from same origin
  if (event.origin !== window.location.origin) return;

  const message = event.data;
  if (!message || message.source !== `${INJECTED_EXTENSION_ID}-dapp`) return;

  // Validate message type
  if (!ALLOWED_MESSAGE_TYPES.includes(message.type as AllowedMessageType)) {
    console.warn(`[Injected] Blocked unauthorized message type: ${message.type}`);
    return;
  }

  try {
    // Forward to background - spread payload BEFORE type to prevent override
    const response = await chrome.runtime.sendMessage({
      ...message.payload,
      type: message.type, // Validated type overwrites any payload.type
      requestId: message.requestId,
    });

    // Send response back to page
    window.postMessage({
      type: `${message.type}_RESPONSE`,
      source: INJECTED_EXTENSION_ID,
      requestId: message.requestId,
      payload: response,
    }, window.location.origin);
  } catch (error) {
    window.postMessage({
      type: `${message.type}_RESPONSE`,
      source: INJECTED_EXTENSION_ID,
      requestId: message.requestId,
      payload: { success: false, error: sanitizeError(error) },
    }, window.location.origin);
  }
});

// Sanitize errors before sending to dApps
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  const mappings: [RegExp, string][] = [
    [/vault is locked/i, 'Extension is locked'],
    [/not initialized/i, 'Extension not set up'],
    [/no matching/i, 'No matching account found'],
  ];

  for (const [pattern, safe] of mappings) {
    if (pattern.test(message)) return safe;
  }

  return 'Request failed';
}

// Inject page API script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-api.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

console.log('[Injected] Midnight Authenticator content script loaded');
