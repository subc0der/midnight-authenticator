/**
 * Background Service Worker
 * Handles message routing, vault management, and proof generation.
 */

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Get trusted origin from sender, not message payload
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : 'unknown');

  handleMessage(message, origin)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Background] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true; // Keep channel open for async response
});

async function handleMessage(
  message: { type: string; [key: string]: unknown },
  origin: string
): Promise<unknown> {
  switch (message.type) {
    case 'GET_VAULT_STATUS':
      return getVaultStatus();

    case 'INIT_VAULT':
      return initVault(message['password'] as string);

    case 'UNLOCK_VAULT':
      return unlockVault(message['password'] as string);

    case 'LOCK_VAULT':
      return lockVault();

    case 'GET_ACCOUNTS':
      return getAccounts();

    default:
      console.warn(`[Background] Unknown message type: ${message.type}`);
      return { success: false, error: 'Unknown message type' };
  }
}

// Vault state (in-memory, lost on SW dormancy)
let vaultUnlocked = false;
let vaultExists = false;

async function getVaultStatus(): Promise<{ exists: boolean; unlocked: boolean }> {
  // Check if vault exists in storage
  const result = await chrome.storage.local.get(['vault']);
  vaultExists = !!result['vault'];
  return { exists: vaultExists, unlocked: vaultUnlocked };
}

async function initVault(password: string): Promise<{ success: boolean }> {
  // TODO: Implement proper encrypted storage with Argon2id
  await chrome.storage.local.set({ vault: { initialized: true } });
  vaultExists = true;
  vaultUnlocked = true;
  return { success: true };
}

async function unlockVault(password: string): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement proper decryption
  const result = await chrome.storage.local.get(['vault']);
  if (!result['vault']) {
    return { success: false, error: 'Vault not initialized' };
  }
  vaultUnlocked = true;
  return { success: true };
}

async function lockVault(): Promise<{ success: boolean }> {
  vaultUnlocked = false;
  return { success: true };
}

async function getAccounts(): Promise<{ success: boolean; accounts?: unknown[]; error?: string }> {
  if (!vaultUnlocked) {
    return { success: false, error: 'Vault is locked' };
  }
  // TODO: Get accounts from encrypted storage
  return { success: true, accounts: [] };
}

// Auto-lock timer
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock') {
    lockVault();
  }
});

console.log('[Background] Midnight Authenticator service worker started');
