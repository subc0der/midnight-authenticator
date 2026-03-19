/**
 * Background Service Worker
 * Handles message routing, vault management, and ZK auth code generation.
 *
 * NOTE: This is a ZK-native authenticator using Midnight's persistentHash.
 * It is NOT RFC 6238 TOTP compatible. Codes will differ from standard authenticators.
 */

import {
  getEncryptedStorage,
  Account,
  EncryptedAccount,
} from '../shared/storage/encrypted-storage';

// Import pure circuits from compiled contract
import { pureCircuits } from '@midnight-authenticator/contracts';

// Import proof service
import {
  getProofService,
  type ProofRequest,
  type ProofResult,
  type PendingAuthRequest,
} from '../shared/proof/index.js';

const storage = getEncryptedStorage();

// Base32 alphabet for secret input (user convenience)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode base32 string to Uint8Array
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
 * Normalize secret to 32 bytes for contract compatibility.
 * Uses SHA-256 hash of input to produce consistent 32-byte output.
 */
async function normalizeSecretTo32Bytes(secret: Uint8Array): Promise<Uint8Array> {
  const buffer = new Uint8Array(secret).buffer as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hash);
}

/**
 * Get current time window (30-second intervals since Unix epoch)
 */
function getCurrentTimeWindow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000 / 30));
}

/**
 * Get remaining seconds in current time window
 */
function getRemainingSeconds(): number {
  const now = Math.floor(Date.now() / 1000);
  return 30 - (now % 30);
}

/**
 * Generate ZK auth code using contract's pure circuit.
 * This uses Midnight's persistentHash - NOT HMAC-SHA1.
 *
 * @param secret - 32-byte secret (normalized)
 * @returns 6-digit code and remaining seconds
 */
function generateZkAuthCode(
  secret: Uint8Array
): { code: string; remainingSeconds: number } {
  const timeWindow = getCurrentTimeWindow();
  const remainingSeconds = getRemainingSeconds();

  // Use contract's pure circuit for hash computation
  // pureCircuits.computeAuthCode expects Bytes<32> and bigint
  const hash = pureCircuits.computeAuthCode(secret, timeWindow);

  // Truncate hash to 6 digits (similar to TOTP dynamic truncation)
  // Use first 4 bytes as a 32-bit integer, mod 10^6
  const view = new DataView(hash.buffer, hash.byteOffset, 4);
  const binary = view.getUint32(0, false) & 0x7fffffff; // Big-endian, clear sign bit
  const otp = binary % 1000000;
  const code = otp.toString().padStart(6, '0');

  return { code, remainingSeconds };
}

/**
 * Compute commitment from secret and blinder using SHA-256.
 * Note: This is for local storage. On-chain uses persistentCommit.
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

// Internal-only message types that should never come from content scripts or dApps
const INTERNAL_ONLY_MESSAGES = [
  'ADD_ACCOUNT',
  'DELETE_ACCOUNT',
  'GET_ACCOUNTS',
  'GET_AUTH_CODE',
  'INIT_VAULT',
  'UNLOCK_VAULT',
  'LOCK_VAULT',
  'GENERATE_AUTH_PROOF', // Proof generation requires vault access
];

// Storage keys
const PENDING_REQUESTS_KEY = 'pendingAuthRequests';
const PROVIDER_PREFERENCE_KEY = 'preferredProofProvider';

// Request expiration time (5 minutes)
const REQUEST_EXPIRATION_MS = 5 * 60 * 1000;

/**
 * Generate a unique request ID.
 */
function generateRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store a pending auth request.
 */
async function storePendingRequest(request: {
  requestId: string;
  origin: string;
  accountId: string;
  challenge?: string;
  tabId?: number;
}): Promise<void> {
  const now = Date.now();
  const pending = {
    ...request,
    createdAt: now,
    expiresAt: now + REQUEST_EXPIRATION_MS,
    status: 'pending' as const,
  };

  const { [PENDING_REQUESTS_KEY]: existing = [] } = await chrome.storage.local.get(PENDING_REQUESTS_KEY);

  // Filter out expired requests
  const filtered = existing.filter((r: any) => r.expiresAt > now);
  filtered.push(pending);

  await chrome.storage.local.set({ [PENDING_REQUESTS_KEY]: filtered });
}

/**
 * Get pending auth requests.
 */
async function getPendingRequests(): Promise<any[]> {
  const { [PENDING_REQUESTS_KEY]: requests = [] } = await chrome.storage.local.get(PENDING_REQUESTS_KEY);
  const now = Date.now();
  return requests.filter((r: any) => r.expiresAt > now && r.status === 'pending');
}

/**
 * Update a pending request's status.
 */
async function updatePendingRequest(requestId: string, update: { status: string; result?: any }): Promise<void> {
  const { [PENDING_REQUESTS_KEY]: requests = [] } = await chrome.storage.local.get(PENDING_REQUESTS_KEY);

  const updated = requests.map((r: any) =>
    r.requestId === requestId ? { ...r, ...update } : r
  );

  await chrome.storage.local.set({ [PENDING_REQUESTS_KEY]: updated });
}

/**
 * Clear completed/expired pending requests.
 */
async function cleanupPendingRequests(): Promise<void> {
  const { [PENDING_REQUESTS_KEY]: requests = [] } = await chrome.storage.local.get(PENDING_REQUESTS_KEY);
  const now = Date.now();

  // Keep only pending requests that haven't expired
  const filtered = requests.filter((r: any) =>
    r.status === 'pending' && r.expiresAt > now
  );

  await chrome.storage.local.set({ [PENDING_REQUESTS_KEY]: filtered });
}

/**
 * Open the extension popup.
 */
async function openPopup(): Promise<void> {
  try {
    // Chrome 116+ supports openPopup
    if (chrome.action.openPopup) {
      await chrome.action.openPopup();
    }
  } catch {
    // Fallback: create a popup window
    const popup = await chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 400,
      height: 600,
      focused: true,
    });
    console.log('[Background] Opened popup window:', popup.id);
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages meant for offscreen document
  if (message.type === 'DERIVE_KEY') {
    return false;
  }

  // Get trusted origin from sender, not message payload
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : 'unknown');

  // Security: Block internal-only messages from non-extension origins
  const isInternal = origin.startsWith(`chrome-extension://${chrome.runtime.id}`);
  if (!isInternal && INTERNAL_ONLY_MESSAGES.includes(message.type)) {
    console.warn(`[Background] Blocked ${message.type} from unauthorized origin: ${origin}`);
    sendResponse({ success: false, error: 'Unauthorized' });
    return true;
  }

  // Get tab ID for pending request tracking
  const tabId = sender.tab?.id;

  handleMessage(message, origin, tabId)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Background] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true; // Keep channel open for async response
});

async function handleMessage(
  message: { type: string; [key: string]: unknown },
  origin: string,
  tabId?: number
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

    case 'GET_AUTH_CODE':
      return getAuthCode(message['accountId'] as string);

    // Legacy support - redirect to new message type
    case 'GET_TOTP_CODE':
      return getAuthCode(message['accountId'] as string);

    case 'KEEPALIVE':
      // Ping to keep SW alive while popup is open
      if (storage.isUnlocked()) {
        resetAutoLockTimer();
      }
      return { success: true };

    case 'GET_PROOF_PROVIDER':
      return getProofProvider();

    case 'GENERATE_AUTH_PROOF':
      return generateAuthProof(
        message['accountId'] as string,
        message['nonce'] as bigint | undefined,
        message['expectedTimeWindow'] as bigint | undefined
      );

    case 'GET_PROOF_STATUS':
      return getProofStatus();

    case 'AUTH_REQUEST':
      return handleAuthRequest(
        message['accountId'] as string,
        message['challenge'] as string | undefined,
        origin,
        tabId
      );

    case 'GET_PENDING_REQUESTS':
      return getPendingAuthRequests();

    case 'PROCESS_PENDING_REQUEST':
      return processPendingRequest(
        message['requestId'] as string,
        message['approved'] as boolean
      );

    case 'SET_PROVIDER_PREFERENCE':
      return setProviderPreference(message['provider'] as string | null);

    case 'GET_PROVIDER_PREFERENCE':
      return getProviderPreference();

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
    const rawSecret = fromBase32(cleanedSecret);

    // Normalize to 32 bytes for contract compatibility
    const secret = await normalizeSecretTo32Bytes(rawSecret);

    // Generate random blinder (32 bytes)
    const blinder = crypto.getRandomValues(new Uint8Array(32));

    // Generate unique account ID (16 bytes)
    // Collision probability is astronomically low (1/2^128), but check anyway for safety
    let id: string;
    do {
      const idBytes = crypto.getRandomValues(new Uint8Array(16));
      id = toHex(idBytes);
    } while (data.accounts.some((a) => a.account.id === id));

    // Compute commitment (for local reference)
    const commitment = await computeCommitment(secret, blinder);

    // Encrypt secret and blinder separately
    const encryptedSecret = await storage.encryptField(secret);
    const encryptedBlinder = await storage.encryptField(blinder);

    const account: Account = {
      id,
      name: name.trim(),
      issuer: issuer.trim(),
      commitment,
      commitmentVersion: 2, // Version 2 = ZK-native (persistentHash), not RFC 6238
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

async function getAuthCode(
  accountId: string
): Promise<{ success: boolean; code?: string; remainingSeconds?: number; error?: string }> {
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

    const encryptedAccount = data.accounts.find((a) => a.account.id === accountId);
    if (!encryptedAccount) {
      return { success: false, error: 'Account not found' };
    }

    // Decrypt the secret (already 32 bytes from addAccount)
    const secret = await storage.decryptField(encryptedAccount.encryptedSecret);

    // Generate ZK auth code using contract's pure circuit
    const { code, remainingSeconds } = generateZkAuthCode(secret);

    // Zero out the secret buffer to minimize memory exposure
    secret.fill(0);

    return { success: true, code, remainingSeconds };
  } catch (error) {
    console.error('[Background] Failed to generate auth code:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ─── Proof Generation Functions ─────────────────────────────────────────────

/**
 * Get the currently available proof provider.
 */
async function getProofProvider(): Promise<{
  success: boolean;
  provider?: string;
  description?: string;
  error?: string;
}> {
  try {
    const proofService = getProofService();
    const provider = await proofService.getAvailableProvider();

    if (!provider) {
      return {
        success: false,
        error: 'No proof provider available',
      };
    }

    return {
      success: true,
      provider,
      description: proofService.getProviderDescription(provider),
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get detailed proof service status.
 */
async function getProofStatus(): Promise<{
  success: boolean;
  status?: {
    activeProvider: string | null;
    proofServerAvailable: boolean;
    laceAvailable: boolean;
    mockEnabled: boolean;
  };
  error?: string;
}> {
  try {
    const proofService = getProofService();
    const status = await proofService.getStatus();
    return { success: true, status };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Generate an authentication proof for an account.
 *
 * @param accountId - The account to authenticate
 * @param nonce - Optional nonce (auto-generated if not provided)
 * @param expectedTimeWindow - Optional time window (uses current if not provided)
 */
async function generateAuthProof(
  accountId: string,
  nonce?: bigint,
  expectedTimeWindow?: bigint
): Promise<{
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
}> {
  if (!storage.isUnlocked()) {
    return { success: false, error: 'Vault is locked' };
  }

  resetAutoLockTimer();

  if (!accountId) {
    return { success: false, error: 'Account ID required' };
  }

  try {
    // Load account data
    const data = await storage.load();
    if (!data) {
      return { success: false, error: 'No vault data' };
    }

    const encryptedAccount = data.accounts.find((a) => a.account.id === accountId);
    if (!encryptedAccount) {
      return { success: false, error: 'Account not found' };
    }

    // Decrypt secret and blinder
    const secret = await storage.decryptField(encryptedAccount.encryptedSecret);
    const blinder = await storage.decryptField(encryptedAccount.encryptedBlinder);

    // Convert accountId from hex string to Uint8Array
    const accountIdBytes = hexToBytes(accountId);
    if (accountIdBytes.length !== 16) {
      secret.fill(0);
      blinder.fill(0);
      return { success: false, error: 'Invalid account ID length' };
    }

    // Pad accountId to 32 bytes (contract expects Bytes<32>)
    const accountId32 = new Uint8Array(32);
    accountId32.set(accountIdBytes, 0);

    // Use provided nonce or generate one based on timestamp
    const finalNonce = nonce ?? BigInt(Date.now());

    // Use provided time window or get current
    const finalTimeWindow = expectedTimeWindow ?? getCurrentTimeWindow();

    // Build proof request
    const proofRequest: ProofRequest = {
      accountId: accountId32,
      nonce: finalNonce,
      expectedTimeWindow: finalTimeWindow,
      secret,
      blinder,
    };

    // Generate proof
    console.log('[Background] Generating auth proof...');
    const proofService = getProofService();
    const result = await proofService.generateProof(proofRequest);

    // Zero out sensitive data
    secret.fill(0);
    blinder.fill(0);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        providerName: result.providerName,
      };
    }

    // Convert Uint8Arrays to regular arrays for JSON serialization
    return {
      success: true,
      proof: result.proof ? Array.from(result.proof) : undefined,
      publicInputs: result.publicInputs
        ? {
            accountId: Array.from(result.publicInputs.accountId),
            nonce: result.publicInputs.nonce.toString(),
            expectedTimeWindow: result.publicInputs.expectedTimeWindow.toString(),
            result: result.publicInputs.result,
          }
        : undefined,
      providerName: result.providerName,
      isMock: result.isMock,
    };
  } catch (error) {
    console.error('[Background] Failed to generate auth proof:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Handle authentication request from a dApp.
 * This is the main entry point for ZK authentication.
 *
 * If the vault is locked, stores the request and opens the popup for unlock.
 *
 * @param accountId - The account to authenticate
 * @param challenge - Optional challenge from the dApp
 * @param origin - Origin of the requesting dApp
 * @param tabId - Tab ID of the requesting page
 */
async function handleAuthRequest(
  accountId: string,
  challenge?: string,
  origin?: string,
  tabId?: number
): Promise<{
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
}> {
  console.log(`[Background] Auth request for account: ${accountId}, challenge: ${challenge || 'none'}, origin: ${origin}`);

  // SECURITY: Always require explicit user approval for auth requests.
  // Never silently generate proofs, even when vault is unlocked.
  // This prevents malicious websites from obtaining proofs without user consent.

  // Store the pending request
  const requestId = generateRequestId();
  await storePendingRequest({
    requestId,
    origin: origin || 'unknown',
    accountId,
    challenge,
    tabId,
  });

  console.log(`[Background] Stored pending auth request: ${requestId}, vault unlocked: ${storage.isUnlocked()}`);

  // Open the popup for user approval
  await openPopup();

  // Return pending status - the dApp will wait for AUTH_REQUEST_COMPLETED
  return {
    success: false,
    error: storage.isUnlocked()
      ? 'Approval required. Please approve in the extension popup.'
      : 'Extension is locked. Please unlock to continue.',
    pendingRequestId: requestId,
  };
}

/**
 * Get pending auth requests (for popup to display).
 */
async function getPendingAuthRequests(): Promise<{
  success: boolean;
  requests?: any[];
  error?: string;
}> {
  try {
    const requests = await getPendingRequests();
    return { success: true, requests };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Process a pending auth request (approve or deny).
 */
async function processPendingRequest(
  requestId: string,
  approved: boolean
): Promise<{
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
}> {
  if (!storage.isUnlocked()) {
    return { success: false, error: 'Vault is locked' };
  }

  const { [PENDING_REQUESTS_KEY]: requests = [] } = await chrome.storage.local.get(PENDING_REQUESTS_KEY);
  const request = requests.find((r: any) => r.requestId === requestId);

  if (!request) {
    return { success: false, error: 'Request not found or expired' };
  }

  if (!approved) {
    await updatePendingRequest(requestId, { status: 'denied' });
    return { success: false, error: 'Request denied by user' };
  }

  // Generate proof
  const result = await generateAuthProof(request.accountId);

  // Update request status
  await updatePendingRequest(requestId, {
    status: result.success ? 'completed' : 'error',
    result,
  });

  // Notify the requesting tab if we have its ID
  if (request.tabId) {
    try {
      await chrome.tabs.sendMessage(request.tabId, {
        type: 'AUTH_REQUEST_COMPLETED',
        requestId,
        result,
      });
    } catch {
      // Tab may have been closed
    }
  }

  return result;
}

/**
 * Set the preferred proof provider (dev mode feature).
 */
async function setProviderPreference(provider: string | null): Promise<{ success: boolean }> {
  if (provider === null) {
    await chrome.storage.local.remove(PROVIDER_PREFERENCE_KEY);
  } else {
    await chrome.storage.local.set({ [PROVIDER_PREFERENCE_KEY]: provider });
  }
  return { success: true };
}

/**
 * Get the preferred proof provider.
 */
async function getProviderPreference(): Promise<{ success: boolean; provider: string | null }> {
  const { [PROVIDER_PREFERENCE_KEY]: provider = null } = await chrome.storage.local.get(PROVIDER_PREFERENCE_KEY);
  return { success: true, provider };
}

/**
 * Convert hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// ─── Auto-Lock Timer ────────────────────────────────────────────────────────

// Auto-lock after 5 minutes of inactivity
function resetAutoLockTimer(): void {
  chrome.alarms.create('auto-lock', { delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-lock') {
    console.log('[Background] Auto-locking vault due to inactivity');
    lockVault();
  } else if (alarm.name === 'cleanup-pending-requests') {
    console.log('[Background] Running periodic pending request cleanup');
    cleanupPendingRequests();
  }
});

// ─── Startup Cleanup ─────────────────────────────────────────────────────────

// Clean up expired pending requests on startup and set up periodic cleanup
chrome.runtime.onStartup.addListener(async () => {
  console.log('[Background] Extension started, cleaning up expired requests');
  await cleanupPendingRequests();
});

// Also run cleanup when service worker initializes (covers install and SW restart)
(async () => {
  await cleanupPendingRequests();
  // Set up periodic cleanup every 10 minutes
  chrome.alarms.create('cleanup-pending-requests', { periodInMinutes: 10 });
})();

console.log('[Background] Midnight Authenticator service worker started (ZK-native mode)');
