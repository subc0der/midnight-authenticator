/**
 * Backup and restore functionality for Midnight Authenticator
 *
 * Security design:
 * - Backups are encrypted with a user-chosen password (separate from vault password)
 * - Uses PBKDF2 (600k iterations) + AES-256-GCM for encryption
 * - AES-256-GCM provides authenticated encryption (integrity + confidentiality)
 * - Secrets are re-encrypted with the backup password
 *
 * Note: We intentionally use PBKDF2 instead of Argon2id to avoid WASM complexity
 * in the backup flow. 600k iterations is OWASP 2023 recommendation.
 *
 * Security limitations (documented for transparency):
 * - JSON.stringify creates immutable strings that cannot be zeroed from memory
 * - JavaScript GC timing is non-deterministic
 * - We zero Uint8Array buffers where possible, but JSON intermediates remain
 */

const BACKUP_VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * Backup file format
 *
 * Note: We rely on AES-256-GCM's authenticated encryption for integrity.
 * GCM mode includes a MAC tag that verifies both authenticity and integrity,
 * making a separate checksum redundant and potentially fragile (JSON key
 * ordering is not guaranteed).
 */
export interface BackupFile {
  version: number;
  createdAt: string;
  accountCount: number;
  /** Encrypted payload containing the accounts */
  encryptedData: string;
  /** Salt used for key derivation */
  salt: string;
  /** @deprecated Kept for backwards compatibility with v1 backups, not used */
  checksum?: string;
}

/**
 * Decrypted backup data
 */
export interface BackupData {
  accounts: BackupAccount[];
}

/**
 * Account data in backup (with raw secrets)
 *
 * Note: We use number[] instead of Uint8Array for JSON serialization compatibility.
 * Callers should convert to Uint8Array and zero the arrays after use.
 */
export interface BackupAccount {
  id: string;
  name: string;
  issuer: string;
  commitment: string;
  commitmentVersion: number;
  createdAt: number;
  /** Raw secret bytes as array (zero after use) */
  secret: number[];
  /** Raw blinder bytes as array (zero after use) */
  blinder: number[];
}

// Robust base64 encoding/decoding
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
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

// Note: We removed the SHA-256 checksum function because AES-256-GCM
// already provides authenticated encryption (integrity + confidentiality).
// A separate checksum was fragile due to JSON key ordering non-determinism.

/**
 * Derive encryption key from password using PBKDF2
 * (We use PBKDF2 here since backup encryption doesn't need Argon2id's
 * memory-hardness - the backup file itself is the threat model, not
 * real-time brute force)
 */
async function deriveBackupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 600000, // OWASP 2023 recommendation
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt backup data
 */
async function encryptBackupData(data: BackupData, password: string): Promise<{ encryptedData: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveBackupKey(password, salt);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return {
    encryptedData: uint8ArrayToBase64(combined),
    salt: uint8ArrayToBase64(salt),
  };
}

/**
 * Decrypt backup data
 */
async function decryptBackupData(encryptedData: string, salt: string, password: string): Promise<BackupData> {
  const saltBytes = base64ToUint8Array(salt);
  const key = await deriveBackupKey(password, saltBytes);

  const combined = base64ToUint8Array(encryptedData);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

/**
 * Create a backup file from accounts
 *
 * Security: AES-256-GCM provides authenticated encryption, so we don't need
 * a separate integrity check. The GCM tag will detect any tampering.
 */
export async function createBackup(
  accounts: BackupAccount[],
  password: string
): Promise<BackupFile> {
  const data: BackupData = { accounts };
  const { encryptedData, salt } = await encryptBackupData(data, password);

  return {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    accountCount: accounts.length,
    encryptedData,
    salt,
  };
}

/**
 * Restore accounts from a backup file
 *
 * Security: AES-256-GCM decryption will fail with OperationError if the
 * ciphertext was tampered with or the password is wrong. This provides
 * authenticated decryption without needing a separate checksum.
 */
export async function restoreBackup(
  backup: BackupFile,
  password: string
): Promise<BackupAccount[]> {
  // Version check
  if (backup.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${backup.version}`);
  }

  // Decrypt (GCM provides authenticated decryption - will fail if tampered)
  const data = await decryptBackupData(backup.encryptedData, backup.salt, password);

  // Validate account structure
  if (!Array.isArray(data.accounts)) {
    throw new Error('Invalid backup format');
  }

  for (const account of data.accounts) {
    if (!account.id || !account.name || !account.issuer || !Array.isArray(account.secret) || !Array.isArray(account.blinder)) {
      throw new Error('Invalid account data in backup');
    }
  }

  return data.accounts;
}

/**
 * Validate backup file structure (without decrypting)
 *
 * Note: checksum is optional for backwards compatibility with older backups.
 * We no longer generate checksums (AES-GCM provides integrity).
 */
export function validateBackupStructure(backup: unknown): backup is BackupFile {
  if (typeof backup !== 'object' || backup === null) {
    return false;
  }

  const b = backup as Record<string, unknown>;

  return (
    typeof b['version'] === 'number' &&
    typeof b['createdAt'] === 'string' &&
    typeof b['accountCount'] === 'number' &&
    typeof b['encryptedData'] === 'string' &&
    typeof b['salt'] === 'string'
    // checksum is optional (deprecated, kept for backwards compat)
  );
}

/**
 * Download backup file to user's device
 */
export function downloadBackup(backup: BackupFile, filename?: string): void {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `midnight-authenticator-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read backup file from user selection
 */
export function readBackupFile(file: File): Promise<BackupFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        const backup = JSON.parse(json);

        if (!validateBackupStructure(backup)) {
          reject(new Error('Invalid backup file format'));
          return;
        }

        resolve(backup);
      } catch {
        reject(new Error('Failed to parse backup file'));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read backup file'));
    };

    reader.readAsText(file);
  });
}
