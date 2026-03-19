/**
 * Background Service Worker
 * Handles message routing, vault management, and proof generation.
 */

import {
  getEncryptedStorage,
  Account,
  EncryptedAccount,
} from '../shared/storage/encrypted-storage';

const storage = getEncryptedStorage();

// Base32 alphabet for TOTP secrets
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode base32 string to Uint8Array (for TOTP secrets)
 */
function fromBase32(base32: string): Uint8Array {
  const cleaned = base32.replace(/\s/g, '').toUpperCase().replace(/=+$/, '');

  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) {
      throw new Error('Invalid base32 character');
    }

    buffer = (buffer << 5) | val;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Convert Uint8Array to hex string
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute commitment from secret and blinder
 * MVP: SHA-256(secret || blinder)
 * Future: Use ZK-friendly hash (Poseidon, etc.)
 */
async function computeCommitment(
  secret: Uint8Array,
  blinder: Uint8Array
): Promise<string> {
  const combined = new Uint8Array(secret.length + blinder.length);
  combined.set(secret, 0);
  combined.set(blinder, secret.length);

  const hash = await crypto.subtle.digest('SHA-256', combined);
  return toHex(new Uint8Array(hash));
}

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

    case 'ADD_ACCOUNT':
      return addAccount(
        message['issuer'] as string,
        message['name'] as string,
        message['secret'] as string
      );

    case 'DELETE_ACCOUNT':
      return deleteAccount(message['accountId'] as string);

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

async function getAccounts(): Promise<{ success: boolean; accounts?: Account[]; error?: string }> {
  if (!storage.isUnlocked()) {
    return { success: false, error: 'Vault is locked' };
  }

  // Reset auto-lock timer on activity
  resetAutoLockTimer();

  try {
    const data = await storage.load();
    // Return only the Account metadata, not encrypted fields
    const accounts = data?.accounts.map((ea) => ea.account) || [];
    return { success: true, accounts };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function addAccount(
  issuer: string,
  name: string,
  secretBase32: string
): Promise<{ success: boolean; account?: Account; error?: string }> {
  if (!storage.isUnlocked()) {
    return { success: false, error: 'Vault is locked' };
  }

  // Reset auto-lock timer on activity
  resetAutoLockTimer();

  // Input validation
  if (!issuer?.trim() || !name?.trim() || !secretBase32?.trim()) {
    return { success: false, error: 'All fields are required' };
  }

  // Validate base32 format
  const base32Regex = /^[A-Z2-7]+=*$/i;
  const cleanedSecret = secretBase32.replace(/\s/g, '');
  if (!base32Regex.test(cleanedSecret)) {
    return { success: false, error: 'Invalid secret format (expected base32)' };
  }

  try {
    const data = (await storage.load()) || { accounts: [] };

    // Decode secret from base32
    const secret = fromBase32(cleanedSecret);

    // Generate random blinder (32 bytes)
    const blinder = crypto.getRandomValues(new Uint8Array(32));

    // Generate account ID (16 bytes)
    const idBytes = crypto.getRandomValues(new Uint8Array(16));
    const id = toHex(idBytes);

    // Compute commitment
    const commitment = await computeCommitment(secret, blinder);

    // Encrypt secret and blinder separately
    const encryptedSecret = await storage.encryptField(secret);
    const encryptedBlinder = await storage.encryptField(blinder);

    const account: Account = {
      id,
      name: name.trim(),
      issuer: issuer.trim(),
      commitment,
      createdAt: Date.now(),
    };

    const encryptedAccount: EncryptedAccount = {
      account,
      encryptedSecret,
      encryptedBlinder,
    };

    data.accounts.push(encryptedAccount);
    await storage.save(data);

    console.log(`[Background] Added account: ${issuer} - ${name}`);
    return { success: true, account };
  } catch (error) {
    console.error('[Background] Failed to add account:', error);
    return { success: false, error: (error as Error).message };
  }
}

async function deleteAccount(
  accountId: string
): Promise<{ success: boolean; error?: string }> {
  if (!storage.isUnlocked()) {
    return { success: false, error: 'Vault is locked' };
  }

  // Reset auto-lock timer on activity
  resetAutoLockTimer();

  if (!accountId) {
    return { success: false, error: 'Account ID required' };
  }

  try {
    const data = await storage.load();
    if (!data) {
      return { success: false, error: 'No vault data' };
    }

    const index = data.accounts.findIndex((a) => a.account.id === accountId);
    if (index === -1) {
      return { success: false, error: 'Account not found' };
    }

    const accountInfo = data.accounts[index]!.account;
    data.accounts.splice(index, 1);
    await storage.save(data);

    console.log(`[Background] Deleted account: ${accountInfo.issuer} - ${accountInfo.name}`);
    return { success: true };
  } catch (error) {
    console.error('[Background] Failed to delete account:', error);
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
