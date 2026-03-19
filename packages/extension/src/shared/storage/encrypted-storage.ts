/**
 * Encrypted storage using Argon2id + AES-256-GCM
 *
 * Security design:
 * - Argon2id for key derivation (memory-hard, GPU-resistant)
 * - Key derivation runs in offscreen document (WASM allowed there)
 * - AES-256-GCM for authenticated encryption
 * - Random salt stored in chrome.storage (per-vault)
 * - Random IV per encryption operation
 * - Encryption key held in memory only, never persisted
 */

// Types exported for use in background and popup
export interface Account {
  id: string;
  name: string;
  issuer: string;
  commitment: string;
  /** Hash algorithm version for commitment. 1 = SHA-256. Future: 2 = Poseidon, etc. */
  commitmentVersion: number;
  createdAt: number;
  lastUsedAt?: number;
}

export interface EncryptedAccount {
  account: Account;
  encryptedSecret: string;
  encryptedBlinder: string;
}

const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// Robust base64 encoding/decoding for binary data
// (Gemini Review #2: Medium Priority - Base64 Encoding Implementation)
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // Process in chunks to avoid call stack issues
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface VaultData {
  accounts: EncryptedAccount[];
  settings?: {
    autoLockMinutes: number;
    [key: string]: unknown;
  };
}

// Offscreen document management
let offscreenCreated = false;

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreated) {
    return;
  }

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }

  // Create offscreen document
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Argon2 key derivation requires WASM which is not available in service workers',
  });

  // Wait for offscreen document to be ready
  await new Promise((resolve) => setTimeout(resolve, 100));

  offscreenCreated = true;
  console.log('[EncryptedStorage] Offscreen document created');
}

async function closeOffscreenDocument(): Promise<void> {
  if (!offscreenCreated) {
    return;
  }

  try {
    await chrome.offscreen.closeDocument();
    offscreenCreated = false;
    console.log('[EncryptedStorage] Offscreen document closed');
  } catch (err) {
    // Document may already be closed
    offscreenCreated = false;
  }
}

async function deriveKeyViaOffscreen(password: string, salt: Uint8Array): Promise<Uint8Array> {
  await ensureOffscreenDocument();

  console.log('[EncryptedStorage] Sending DERIVE_KEY to offscreen...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'DERIVE_KEY',
      password,
      salt: Array.from(salt),
    });

    if (!response) {
      throw new Error('Key derivation failed - no response from offscreen');
    }

    if (!response.success) {
      throw new Error(response.error || 'Key derivation failed');
    }

    return new Uint8Array(response.keyBytes);
  } finally {
    // Close offscreen document after use to reduce attack surface
    // (Gemini Review #2: High Priority - Offscreen Document Persistence)
    await closeOffscreenDocument();
  }
}

export class EncryptedStorage {
  private encryptionKey: CryptoKey | null = null;

  /**
   * Initialize a new vault with a password
   */
  async initialize(password: string): Promise<void> {
    // Generate random salt
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

    // Derive key using Argon2id via offscreen document
    this.encryptionKey = await this.deriveKey(password, salt);

    // Store salt (but not the key!)
    await chrome.storage.local.set({
      vaultSalt: Array.from(salt),
    });

    // Initialize empty vault
    await this.save({ accounts: [] });

    console.log('[EncryptedStorage] Vault initialized');
  }

  /**
   * Unlock an existing vault with a password
   */
  async unlock(password: string): Promise<void> {
    const result = await chrome.storage.local.get(['vaultSalt', 'encryptedVault']);

    if (!result['vaultSalt']) {
      throw new Error('No vault found');
    }

    const salt = new Uint8Array(result['vaultSalt']);

    // Derive key using Argon2id via offscreen document
    this.encryptionKey = await this.deriveKey(password, salt);

    // Verify by attempting to decrypt
    if (result['encryptedVault']) {
      try {
        await this.decrypt(result['encryptedVault']);
        console.log('[EncryptedStorage] Vault unlocked');
      } catch {
        this.encryptionKey = null;
        throw new Error('Incorrect password');
      }
    }
  }

  /**
   * Lock the vault (clear encryption key from memory)
   */
  lock(): void {
    this.encryptionKey = null;
    console.log('[EncryptedStorage] Vault locked');
  }

  /**
   * Check if vault exists
   */
  async exists(): Promise<boolean> {
    const result = await chrome.storage.local.get(['vaultSalt']);
    return !!result['vaultSalt'];
  }

  /**
   * Check if the vault is unlocked
   */
  isUnlocked(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * Save data to encrypted storage
   */
  async save(data: VaultData): Promise<void> {
    if (!this.encryptionKey) {
      throw new Error('Vault is locked');
    }

    const encryptedVault = await this.encrypt(data);
    await chrome.storage.local.set({ encryptedVault });
  }

  /**
   * Load data from encrypted storage
   */
  async load(): Promise<VaultData | null> {
    if (!this.encryptionKey) {
      throw new Error('Vault is locked');
    }

    const result = await chrome.storage.local.get(['encryptedVault']);

    if (!result['encryptedVault']) {
      return null;
    }

    return this.decrypt(result['encryptedVault']);
  }

  /**
   * Derive encryption key from password using Argon2id
   */
  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const keyBytes = await deriveKeyViaOffscreen(password, salt);

    return crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  private async encrypt(data: VaultData): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error('No encryption key');
    }

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(data));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      plaintext
    );

    // Combine IV + ciphertext and encode as base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return uint8ArrayToBase64(combined);
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  private async decrypt(encryptedData: string): Promise<VaultData> {
    if (!this.encryptionKey) {
      throw new Error('No encryption key');
    }

    const combined = base64ToUint8Array(encryptedData);

    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(plaintext));
  }

  /**
   * Encrypt a single field (for secret/blinder)
   */
  async encryptField(data: Uint8Array): Promise<string> {
    if (!this.encryptionKey) {
      throw new Error('Vault is locked');
    }

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      data.buffer as ArrayBuffer
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return uint8ArrayToBase64(combined);
  }

  /**
   * Decrypt a single field
   */
  async decryptField(encrypted: string): Promise<Uint8Array> {
    if (!this.encryptionKey) {
      throw new Error('Vault is locked');
    }

    const combined = base64ToUint8Array(encrypted);
    const iv = combined.slice(0, IV_LENGTH);
    const ciphertext = combined.slice(IV_LENGTH);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      ciphertext
    );

    return new Uint8Array(plaintext);
  }
}

// Singleton instance
let storageInstance: EncryptedStorage | null = null;

export function getEncryptedStorage(): EncryptedStorage {
  if (!storageInstance) {
    storageInstance = new EncryptedStorage();
  }
  return storageInstance;
}
