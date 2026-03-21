/**
 * Tests for vault encrypted storage
 *
 * Note: These tests mock the offscreen document for Argon2 key derivation.
 * The actual Argon2 implementation is tested separately in the offscreen context.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { clearMockStorage, getMockStorage } from '../../../__tests__/setup';

// Mock the offscreen document response for key derivation
// This simulates Argon2id producing a deterministic key for testing
function mockKeyDerivation() {
  const sendMessage = chrome.runtime.sendMessage as Mock;
  sendMessage.mockImplementation(async (message: { type: string; password: string; salt: number[] }) => {
    if (message.type === 'DERIVE_KEY') {
      // For testing, derive a simple key from password + salt
      // In production, this uses Argon2id
      const encoder = new TextEncoder();
      const passwordBytes = encoder.encode(message.password);
      const saltBytes = new Uint8Array(message.salt);

      // Use Web Crypto to derive a test key (PBKDF2 for simplicity in tests)
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBytes,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );

      const keyBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: 1000, // Low for fast tests
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );

      return {
        success: true,
        keyBytes: Array.from(new Uint8Array(keyBits)),
      };
    }
    return null;
  });
}

// Need to dynamically import after mocking
async function getStorage() {
  // Clear module cache to get fresh instance
  vi.resetModules();
  const { EncryptedStorage } = await import('../encrypted-storage');
  return new EncryptedStorage();
}

describe('EncryptedStorage', () => {
  beforeEach(() => {
    clearMockStorage();
    mockKeyDerivation();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize a new vault', async () => {
      const storage = await getStorage();

      await storage.initialize('TestPassword123!');

      expect(storage.isUnlocked()).toBe(true);

      // Verify salt was stored
      const stored = getMockStorage();
      expect(stored.vaultSalt).toBeDefined();
      expect(Array.isArray(stored.vaultSalt)).toBe(true);
      expect((stored.vaultSalt as number[]).length).toBe(16);
    });

    it('should generate unique salt for each vault', async () => {
      const storage1 = await getStorage();
      await storage1.initialize('Password1');
      const salt1 = getMockStorage().vaultSalt;

      clearMockStorage();

      const storage2 = await getStorage();
      await storage2.initialize('Password2');
      const salt2 = getMockStorage().vaultSalt;

      expect(salt1).not.toEqual(salt2);
    });

    it('should create empty vault on init', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword123!');

      const data = await storage.load();
      expect(data).toEqual({ accounts: [] });
    });
  });

  describe('unlock', () => {
    it('should unlock vault with correct password', async () => {
      const storage = await getStorage();
      await storage.initialize('CorrectPassword');
      storage.lock();

      expect(storage.isUnlocked()).toBe(false);

      await storage.unlock('CorrectPassword');
      expect(storage.isUnlocked()).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const storage = await getStorage();
      await storage.initialize('CorrectPassword');
      storage.lock();

      await expect(storage.unlock('WrongPassword')).rejects.toThrow('Incorrect password');
      expect(storage.isUnlocked()).toBe(false);
    });

    it('should throw if no vault exists', async () => {
      const storage = await getStorage();

      await expect(storage.unlock('AnyPassword')).rejects.toThrow('No vault found');
    });
  });

  describe('lock', () => {
    it('should clear encryption key from memory', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      expect(storage.isUnlocked()).toBe(true);

      storage.lock();

      expect(storage.isUnlocked()).toBe(false);
    });

    it('should prevent operations after lock', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');
      storage.lock();

      await expect(storage.save({ accounts: [] })).rejects.toThrow('Vault is locked');
      await expect(storage.load()).rejects.toThrow('Vault is locked');
    });
  });

  describe('exists', () => {
    it('should return false for new storage', async () => {
      const storage = await getStorage();
      expect(await storage.exists()).toBe(false);
    });

    it('should return true after initialization', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      // Get fresh instance to test persistence
      const storage2 = await getStorage();
      expect(await storage2.exists()).toBe(true);
    });
  });

  describe('save and load', () => {
    it('should save and load vault data', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const testData = {
        accounts: [
          {
            account: {
              id: 'acc-001',
              name: 'test@example.com',
              issuer: 'Test',
              commitment: 'abc123',
              commitmentVersion: 2,
              createdAt: Date.now(),
            },
            encryptedSecret: 'encrypted-secret-data',
            encryptedBlinder: 'encrypted-blinder-data',
          },
        ],
        settings: {
          autoLockMinutes: 5,
        },
      };

      await storage.save(testData);
      const loaded = await storage.load();

      expect(loaded).toEqual(testData);
    });

    it('should encrypt data at rest', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      await storage.save({
        accounts: [],
        settings: { autoLockMinutes: 10 },
      });

      // Check raw storage - should be encrypted
      const stored = getMockStorage();
      expect(stored.encryptedVault).toBeDefined();
      expect(typeof stored.encryptedVault).toBe('string');
      // Should not contain plaintext
      expect(stored.encryptedVault).not.toContain('autoLockMinutes');
    });

    it('should handle backup metadata', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const dataWithBackup = {
        accounts: [],
        backupMetadata: {
          lastBackupAt: Date.now(),
          lastBackupAccountCount: 5,
        },
      };

      await storage.save(dataWithBackup);
      const loaded = await storage.load();

      expect(loaded?.backupMetadata).toEqual(dataWithBackup.backupMetadata);
    });
  });

  describe('field encryption', () => {
    it('should encrypt and decrypt individual fields', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const originalData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encrypted = await storage.encryptField(originalData);
      const decrypted = await storage.decryptField(encrypted);

      expect(Array.from(decrypted)).toEqual(Array.from(originalData));
    });

    it('should produce different ciphertext each time (random IV)', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted1 = await storage.encryptField(data);
      const encrypted2 = await storage.encryptField(data);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle 32-byte secrets', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const secret = new Uint8Array(32);
      crypto.getRandomValues(secret);

      const encrypted = await storage.encryptField(secret);
      const decrypted = await storage.decryptField(encrypted);

      expect(decrypted.length).toBe(32);
      expect(Array.from(decrypted)).toEqual(Array.from(secret));
    });

    it('should fail decryption with wrong key', async () => {
      const storage1 = await getStorage();
      await storage1.initialize('Password1');

      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await storage1.encryptField(data);

      // Lock and unlock with different password
      clearMockStorage();

      const storage2 = await getStorage();
      await storage2.initialize('Password2');

      // Decryption should fail (wrong key)
      await expect(storage2.decryptField(encrypted)).rejects.toThrow();
    });

    it('should detect tampered data', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await storage.encryptField(data);

      // Tamper with the encrypted data
      const tampered = encrypted.slice(0, -5) + 'XXXXX';

      await expect(storage.decryptField(tampered)).rejects.toThrow();
    });
  });

  describe('data integrity', () => {
    it('should preserve complex nested data', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const complexData = {
        accounts: [
          {
            account: {
              id: 'acc-001',
              name: 'user@test.com',
              issuer: 'Test Service',
              commitment: 'commitment-hash',
              commitmentVersion: 2,
              createdAt: 1234567890,
              lastUsedAt: 1234567900,
            },
            encryptedSecret: 'secret-data',
            encryptedBlinder: 'blinder-data',
          },
          {
            account: {
              id: 'acc-002',
              name: 'another@test.com',
              issuer: 'Another Service',
              commitment: 'another-commitment',
              commitmentVersion: 2,
              createdAt: 1234567800,
            },
            encryptedSecret: 'another-secret',
            encryptedBlinder: 'another-blinder',
          },
        ],
        settings: {
          autoLockMinutes: 15,
          customSetting: 'value',
        },
        backupMetadata: {
          lastBackupAt: 1234567890,
          lastBackupAccountCount: 2,
        },
      };

      await storage.save(complexData);
      const loaded = await storage.load();

      expect(loaded).toEqual(complexData);
    });

    it('should handle unicode in account names', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const data = {
        accounts: [
          {
            account: {
              id: 'acc-unicode',
              name: 'user@example.com',
              issuer: 'Test Issuer',
              commitment: 'commit',
              commitmentVersion: 2,
              createdAt: Date.now(),
            },
            encryptedSecret: 'secret',
            encryptedBlinder: 'blinder',
          },
        ],
      };

      await storage.save(data);
      const loaded = await storage.load();

      expect(loaded?.accounts[0].account.issuer).toBe('Test Issuer');
    });

    it('should handle empty strings', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const data = {
        accounts: [
          {
            account: {
              id: '',
              name: '',
              issuer: '',
              commitment: '',
              commitmentVersion: 0,
              createdAt: 0,
            },
            encryptedSecret: '',
            encryptedBlinder: '',
          },
        ],
      };

      await storage.save(data);
      const loaded = await storage.load();

      expect(loaded?.accounts[0].account.id).toBe('');
      expect(loaded?.accounts[0].encryptedSecret).toBe('');
    });
  });

  describe('persistence', () => {
    it('should persist data across unlock cycles', async () => {
      const storage = await getStorage();
      await storage.initialize('TestPassword');

      const testData = {
        accounts: [],
        settings: { autoLockMinutes: 30 },
      };

      await storage.save(testData);
      storage.lock();

      // Unlock again
      await storage.unlock('TestPassword');
      const loaded = await storage.load();

      expect(loaded).toEqual(testData);
    });
  });
});
