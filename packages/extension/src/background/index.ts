/**
 * Background Service Worker
 * Handles message routing, vault management, and proof generation.
 */

import { getEncryptedStorage } from '../shared/storage/encrypted-storage';

const storage = getEncryptedStorage();

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages meant for offscreen document
  if (message.type === 'DERIVE_KEY') {
    return false;
  }

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

async function getVaultStatus(): Promise<{ exists: boolean; unlocked: boolean }> {
  const exists = await storage.exists();
  const unlocked = storage.isUnlocked();
  return { exists, unlocked };
}

async function initVault(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    await storage.initialize(password);
    resetAutoLockTimer();
    return { success: true };
  } catch (error) {
    console.error('[Background] Failed to initialize vault:', error);
    return { success: false, error: (error as Error).message };
  }
}

async function unlockVault(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    await storage.unlock(password);
    resetAutoLockTimer();
    return { success: true };
  } catch (error) {
    console.error('[Background] Failed to unlock vault:', error);
    return { success: false, error: (error as Error).message };
  }
}

async function lockVault(): Promise<{ success: boolean }> {
  storage.lock();
  await chrome.alarms.clear('auto-lock');
  return { success: true };
}

async function getAccounts(): Promise<{ success: boolean; accounts?: unknown[]; error?: string }> {
  if (!storage.isUnlocked()) {
    return { success: false, error: 'Vault is locked' };
  }

  try {
    const data = await storage.load();
    return { success: true, accounts: data?.accounts || [] };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// Auto-lock after 5 minutes of inactivity
function resetAutoLockTimer(): void {
  chrome.alarms.create('auto-lock', { delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock') {
    console.log('[Background] Auto-locking vault due to inactivity');
    lockVault();
  }
});

console.log('[Background] Midnight Authenticator service worker started');
