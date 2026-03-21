/**
 * Tests for backup/restore functionality
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBackup,
  restoreBackup,
  validateBackupStructure,
  type BackupAccount,
  type BackupFile,
} from '../backup';

// Test accounts
const testAccounts: BackupAccount[] = [
  {
    id: 'acc-001',
    name: 'test@example.com',
    issuer: 'Test Service',
    commitment: 'abc123',
    commitmentVersion: 2,
    createdAt: Date.now(),
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    blinder: Array.from(crypto.getRandomValues(new Uint8Array(32))),
  },
  {
    id: 'acc-002',
    name: 'work@company.com',
    issuer: 'Work dApp',
    commitment: 'def456',
    commitmentVersion: 2,
    createdAt: Date.now() - 86400000,
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    blinder: Array.from(crypto.getRandomValues(new Uint8Array(32))),
  },
];

const strongPassword = 'SecureBackup123!';
const weakPassword = 'password';

describe('Backup Creation', () => {
  it('should create a valid backup file', async () => {
    const backup = await createBackup(testAccounts, strongPassword);

    expect(backup.version).toBe(1);
    expect(backup.accountCount).toBe(2);
    expect(backup.encryptedData).toBeDefined();
    expect(backup.salt).toBeDefined();
    expect(backup.createdAt).toBeDefined();
    // Checksum should NOT be present (removed in review #8)
    expect(backup.checksum).toBeUndefined();
  });

  it('should encrypt account data', async () => {
    const backup = await createBackup(testAccounts, strongPassword);

    // Encrypted data should not contain plaintext account info
    expect(backup.encryptedData).not.toContain('test@example.com');
    expect(backup.encryptedData).not.toContain('Test Service');
  });

  it('should use different salt each time', async () => {
    const backup1 = await createBackup(testAccounts, strongPassword);
    const backup2 = await createBackup(testAccounts, strongPassword);

    expect(backup1.salt).not.toBe(backup2.salt);
    expect(backup1.encryptedData).not.toBe(backup2.encryptedData);
  });
});

describe('Backup Restoration', () => {
  let backup: BackupFile;

  beforeEach(async () => {
    backup = await createBackup(testAccounts, strongPassword);
  });

  it('should restore accounts with correct password', async () => {
    const restored = await restoreBackup(backup, strongPassword);

    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe('acc-001');
    expect(restored[0].name).toBe('test@example.com');
    expect(restored[0].issuer).toBe('Test Service');
    expect(restored[0].secret).toHaveLength(32);
    expect(restored[0].blinder).toHaveLength(32);
  });

  it('should fail with wrong password', async () => {
    await expect(restoreBackup(backup, 'wrongpassword')).rejects.toThrow();
  });

  it('should fail with tampered data', async () => {
    // Tamper with encrypted data
    const tamperedBackup = {
      ...backup,
      encryptedData: backup.encryptedData.slice(0, -10) + 'TAMPERED!!',
    };

    await expect(restoreBackup(tamperedBackup, strongPassword)).rejects.toThrow();
  });

  it('should reject unsupported version', async () => {
    const futureBackup = { ...backup, version: 999 };

    await expect(restoreBackup(futureBackup, strongPassword)).rejects.toThrow(
      'Unsupported backup version'
    );
  });
});

describe('Backup Structure Validation', () => {
  it('should validate correct backup structure', () => {
    const validBackup = {
      version: 1,
      createdAt: '2026-03-20T00:00:00Z',
      accountCount: 2,
      encryptedData: 'base64data',
      salt: 'base64salt',
    };

    expect(validateBackupStructure(validBackup)).toBe(true);
  });

  it('should accept backup with deprecated checksum field', () => {
    // Old backups may have checksum - should still validate
    const oldBackup = {
      version: 1,
      createdAt: '2026-03-20T00:00:00Z',
      accountCount: 2,
      encryptedData: 'base64data',
      salt: 'base64salt',
      checksum: 'oldchecksum',
    };

    expect(validateBackupStructure(oldBackup)).toBe(true);
  });

  it('should reject missing required fields', () => {
    expect(validateBackupStructure({})).toBe(false);
    expect(validateBackupStructure({ version: 1 })).toBe(false);
    expect(validateBackupStructure(null)).toBe(false);
    expect(validateBackupStructure('not an object')).toBe(false);
  });

  it('should reject wrong field types', () => {
    expect(
      validateBackupStructure({
        version: '1', // should be number
        createdAt: '2026-03-20',
        accountCount: 2,
        encryptedData: 'data',
        salt: 'salt',
      })
    ).toBe(false);
  });
});

describe('Round-trip Integrity', () => {
  it('should preserve all account data through export/import', async () => {
    const original = testAccounts[0];
    const backup = await createBackup([original], strongPassword);
    const [restored] = await restoreBackup(backup, strongPassword);

    expect(restored.id).toBe(original.id);
    expect(restored.name).toBe(original.name);
    expect(restored.issuer).toBe(original.issuer);
    expect(restored.commitment).toBe(original.commitment);
    expect(restored.commitmentVersion).toBe(original.commitmentVersion);
    expect(restored.createdAt).toBe(original.createdAt);
    expect(restored.secret).toEqual(original.secret);
    expect(restored.blinder).toEqual(original.blinder);
  });

  it('should handle empty account list', async () => {
    const backup = await createBackup([], strongPassword);
    const restored = await restoreBackup(backup, strongPassword);

    expect(restored).toHaveLength(0);
  });

  it('should handle many accounts', async () => {
    const manyAccounts = Array.from({ length: 50 }, (_, i) => ({
      id: `acc-${i.toString().padStart(3, '0')}`,
      name: `user${i}@example.com`,
      issuer: `Service ${i}`,
      commitment: `commit${i}`,
      commitmentVersion: 2,
      createdAt: Date.now() - i * 1000,
      secret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
      blinder: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    }));

    const backup = await createBackup(manyAccounts, strongPassword);
    const restored = await restoreBackup(backup, strongPassword);

    expect(restored).toHaveLength(50);
    expect(restored[0].id).toBe('acc-000');
    expect(restored[49].id).toBe('acc-049');
  });
});
