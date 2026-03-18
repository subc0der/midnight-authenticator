/**
 * Page API - Injected into page context
 * Provides window.midnightAuth API for dApps
 */

const EXTENSION_ID = 'midnight-authenticator';

interface AuthRequest {
  accountId: string;
  challenge?: string;
}

interface AuthResult {
  success: boolean;
  proof?: string;
  error?: string;
}

interface MidnightAuthAPI {
  requestAuth: (request: AuthRequest) => Promise<AuthResult>;
  getAccounts: () => Promise<{ success: boolean; accounts?: string[]; error?: string }>;
  isAvailable: () => boolean;
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function sendRequest<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = generateRequestId();

    function handleResponse(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;

      const message = event.data;
      if (!message || message.source !== EXTENSION_ID) return;
      if (message.type !== `${type}_RESPONSE`) return;
      if (message.requestId !== requestId) return;

      window.removeEventListener('message', handleResponse);

      if (message.payload?.success === false) {
        reject(new Error(message.payload.error || 'Request failed'));
      } else {
        resolve(message.payload as T);
      }
    }

    window.addEventListener('message', handleResponse);

    window.postMessage({
      type,
      source: `${EXTENSION_ID}-dapp`,
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
    return sendRequest<AuthResult>('AUTH_REQUEST', request);
  },

  async getAccounts(): Promise<{ success: boolean; accounts?: string[]; error?: string }> {
    return sendRequest('GET_ACCOUNTS');
  },

  isAvailable(): boolean {
    return true;
  },
};

// Expose to page
(window as unknown as { midnightAuth: MidnightAuthAPI }).midnightAuth = midnightAuth;

console.log('[PageAPI] window.midnightAuth is available');
