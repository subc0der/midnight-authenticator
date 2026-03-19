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
// See: subcoder/gemini/REVIEW_FEEDBACK.md - Critical Issue #2
const ALLOWED_MESSAGE_TYPES = [
  'AUTH_REQUEST',       // Requires popup approval
  'REGISTER_ACCOUNT',   // Requires popup approval
  'GET_PROOF_PROVIDER', // Safe - only returns provider name
  'GET_PROOF_STATUS',   // Safe - returns availability status
] as const;

type AllowedMessageType = typeof ALLOWED_MESSAGE_TYPES[number];

// Pending Lace check requests (waiting for page context response)
const pendingLaceChecks = new Map<string, (response: { laceAvailable: boolean; proverUri?: string }) => void>();

// Listen for Lace status from page context
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;

  const message = event.data;
  if (!message || message.source !== `${INJECTED_EXTENSION_ID}-page`) return;

  if (message.type === 'LACE_STATUS_RESPONSE') {
    const callback = pendingLaceChecks.get(message.requestId);
    if (callback) {
      pendingLaceChecks.delete(message.requestId);
      callback({
        laceAvailable: message.laceAvailable,
        proverUri: message.proverUri,
      });
    }
  }
});

// Listen for messages from background (for Lace detection and auth completion)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_LACE_AVAILABLE') {
    // Ask page context to check for Lace (content script can't see page's window.midnight)
    const requestId = `lace-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Set up response handler
    const timeoutId = setTimeout(() => {
      pendingLaceChecks.delete(requestId);
      sendResponse({ laceAvailable: false });
    }, 1000);

    pendingLaceChecks.set(requestId, (response) => {
      clearTimeout(timeoutId);
      sendResponse(response);
    });

    // Ask page context
    window.postMessage({
      type: 'CHECK_LACE_STATUS',
      source: `${INJECTED_EXTENSION_ID}-content`,
      requestId,
    }, window.location.origin);

    return true; // Keep channel open for async response
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
