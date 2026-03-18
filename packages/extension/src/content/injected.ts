/**
 * Content Script - Bridge between page and extension
 *
 * Security:
 * - Whitelists allowed message types
 * - Uses sender.origin for trust
 * - Spreads payload BEFORE setting type to prevent override attacks
 */

const INJECTED_EXTENSION_ID = 'midnight-authenticator';
// SECURITY: Only message types that require user approval popup are allowed.
// GET_ACCOUNTS removed - was a privacy leak (any site could enumerate user's accounts)
// See: subcoder/gemini/REVIEW_FEEDBACK.md - Critical Issue #2
const ALLOWED_MESSAGE_TYPES = [
  'AUTH_REQUEST',      // Requires popup approval
  'REGISTER_ACCOUNT',  // Requires popup approval
] as const;

type AllowedMessageType = typeof ALLOWED_MESSAGE_TYPES[number];

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
