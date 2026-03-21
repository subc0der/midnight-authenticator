/**
 * Tests for account CRUD operations
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateAccountId,
  validateAccountInput,
  accountExists,
  findDuplicateAccount,
  getAccountById,
  getAllAccounts,
  createAccount,
  deleteAccount,
  touchAccount,
  sortAccounts,
  filterAccounts,
  type Account,
  type EncryptedAccount,
} from '../accounts';
import type { VaultData } from '../encrypted-storage';

// Helper to create test accounts
function createTestAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: generateAccountId(),
    name: 'test@example.com',
    issuer: 'Test Service',
    commitment: 'test-commitment',
    commitmentVersion: 2,
    createdAt: Date.now(),
    ...overrides,
  };
}

function createTestEncryptedAccount(overrides: Partial<Account> = {}): EncryptedAccount {
  return {
    account: createTestAccount(overrides),
    encryptedSecret: 'encrypted-secret-data',
    encryptedBlinder: 'encrypted-blinder-data',
  };
}

function createTestVaultData(accounts: EncryptedAccount[] = []): VaultData {
  return { accounts };
}

describe('generateAccountId', () => {
  it('should generate 32-character hex string', () => {
    const id = generateAccountId();
    expect(id.length).toBe(32);
    expect(/^[a-f0-9]{32}$/.test(id)).toBe(true);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateAccountId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('validateAccountInput', () => {
  it('should accept valid input', () => {
    expect(validateAccountInput('GitHub', 'user@example.com')).toEqual({
      success: true,
    });
  });

  it('should reject empty issuer', () => {
    expect(validateAccountInput('', 'user@example.com')).toEqual({
      success: false,
      error: 'Service name is required',
    });
    expect(validateAccountInput('   ', 'user@example.com')).toEqual({
      success: false,
      error: 'Service name is required',
    });
  });

  it('should reject empty name', () => {
    expect(validateAccountInput('GitHub', '')).toEqual({
      success: false,
      error: 'Account name is required',
    });
    expect(validateAccountInput('GitHub', '   ')).toEqual({
      success: false,
      error: 'Account name is required',
    });
  });

  it('should reject undefined values', () => {
    expect(validateAccountInput(undefined, 'user@example.com')).toEqual({
      success: false,
      error: 'Service name is required',
    });
    expect(validateAccountInput('GitHub', undefined)).toEqual({
      success: false,
      error: 'Account name is required',
    });
  });

  it('should reject names that are too long', () => {
    const longName = 'a'.repeat(101);
    expect(validateAccountInput('GitHub', longName)).toEqual({
      success: false,
      error: 'Account name too long (max 100 characters)',
    });
  });

  it('should reject issuers that are too long', () => {
    const longIssuer = 'a'.repeat(101);
    expect(validateAccountInput(longIssuer, 'user@example.com')).toEqual({
      success: false,
      error: 'Service name too long (max 100 characters)',
    });
  });

  it('should accept names at max length', () => {
    const maxName = 'a'.repeat(100);
    expect(validateAccountInput('GitHub', maxName).success).toBe(true);
  });
});

describe('accountExists', () => {
  it('should return true for existing account', () => {
    const account = createTestEncryptedAccount({ id: 'test-id-123' });
    const data = createTestVaultData([account]);
    expect(accountExists(data, 'test-id-123')).toBe(true);
  });

  it('should return false for non-existent account', () => {
    const account = createTestEncryptedAccount({ id: 'test-id-123' });
    const data = createTestVaultData([account]);
    expect(accountExists(data, 'different-id')).toBe(false);
  });

  it('should return false for empty vault', () => {
    const data = createTestVaultData([]);
    expect(accountExists(data, 'any-id')).toBe(false);
  });
});

describe('findDuplicateAccount', () => {
  it('should find duplicate by issuer and name', () => {
    const account = createTestEncryptedAccount({
      issuer: 'GitHub',
      name: 'user@example.com',
    });
    const data = createTestVaultData([account]);

    const duplicate = findDuplicateAccount(data, 'GitHub', 'user@example.com');
    expect(duplicate).toBeDefined();
    expect(duplicate?.account.issuer).toBe('GitHub');
  });

  it('should be case-insensitive', () => {
    const account = createTestEncryptedAccount({
      issuer: 'GitHub',
      name: 'User@Example.com',
    });
    const data = createTestVaultData([account]);

    expect(findDuplicateAccount(data, 'github', 'user@example.com')).toBeDefined();
    expect(findDuplicateAccount(data, 'GITHUB', 'USER@EXAMPLE.COM')).toBeDefined();
  });

  it('should trim whitespace', () => {
    const account = createTestEncryptedAccount({
      issuer: 'GitHub',
      name: 'user@example.com',
    });
    const data = createTestVaultData([account]);

    expect(findDuplicateAccount(data, '  GitHub  ', '  user@example.com  ')).toBeDefined();
  });

  it('should return undefined for no match', () => {
    const account = createTestEncryptedAccount({
      issuer: 'GitHub',
      name: 'user@example.com',
    });
    const data = createTestVaultData([account]);

    expect(findDuplicateAccount(data, 'GitLab', 'user@example.com')).toBeUndefined();
    expect(findDuplicateAccount(data, 'GitHub', 'other@example.com')).toBeUndefined();
  });
});

describe('getAccountById', () => {
  it('should return account by ID', () => {
    const account = createTestEncryptedAccount({ id: 'target-id' });
    const data = createTestVaultData([account]);

    const result = getAccountById(data, 'target-id');
    expect(result).toBeDefined();
    expect(result?.account.id).toBe('target-id');
  });

  it('should return undefined for non-existent ID', () => {
    const account = createTestEncryptedAccount({ id: 'other-id' });
    const data = createTestVaultData([account]);

    expect(getAccountById(data, 'target-id')).toBeUndefined();
  });
});

describe('getAllAccounts', () => {
  it('should return all account metadata', () => {
    const accounts = [
      createTestEncryptedAccount({ id: 'id-1', name: 'account1' }),
      createTestEncryptedAccount({ id: 'id-2', name: 'account2' }),
      createTestEncryptedAccount({ id: 'id-3', name: 'account3' }),
    ];
    const data = createTestVaultData(accounts);

    const result = getAllAccounts(data);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('id-1');
    expect(result[1].id).toBe('id-2');
    expect(result[2].id).toBe('id-3');
  });

  it('should not include encrypted fields', () => {
    const account = createTestEncryptedAccount();
    const data = createTestVaultData([account]);

    const result = getAllAccounts(data);
    expect(result[0]).not.toHaveProperty('encryptedSecret');
    expect(result[0]).not.toHaveProperty('encryptedBlinder');
  });

  it('should return empty array for empty vault', () => {
    const data = createTestVaultData([]);
    expect(getAllAccounts(data)).toEqual([]);
  });
});

describe('createAccount', () => {
  it('should create a new account', () => {
    const data = createTestVaultData([]);
    const result = createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });

    expect(result.success).toBe(true);
    expect(result.data?.account.issuer).toBe('GitHub');
    expect(result.data?.account.name).toBe('user@example.com');
    expect(result.data?.data.accounts).toHaveLength(1);
  });

  it('should generate unique ID', () => {
    const data = createTestVaultData([]);
    const result = createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });

    expect(result.data?.account.id).toHaveLength(32);
    expect(/^[a-f0-9]{32}$/.test(result.data?.account.id ?? '')).toBe(true);
  });

  it('should trim issuer and name', () => {
    const data = createTestVaultData([]);
    const result = createAccount(data, {
      issuer: '  GitHub  ',
      name: '  user@example.com  ',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });

    expect(result.data?.account.issuer).toBe('GitHub');
    expect(result.data?.account.name).toBe('user@example.com');
  });

  it('should set createdAt timestamp', () => {
    const before = Date.now();
    const data = createTestVaultData([]);
    const result = createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });
    const after = Date.now();

    expect(result.data?.account.createdAt).toBeGreaterThanOrEqual(before);
    expect(result.data?.account.createdAt).toBeLessThanOrEqual(after);
  });

  it('should use default commitmentVersion', () => {
    const data = createTestVaultData([]);
    const result = createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });

    expect(result.data?.account.commitmentVersion).toBe(2);
  });

  it('should allow custom commitmentVersion', () => {
    const data = createTestVaultData([]);
    const result = createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
      commitmentVersion: 3,
    });

    expect(result.data?.account.commitmentVersion).toBe(3);
  });

  it('should reject duplicate accounts', () => {
    const existing = createTestEncryptedAccount({
      issuer: 'GitHub',
      name: 'user@example.com',
    });
    const data = createTestVaultData([existing]);

    const result = createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('should reject invalid input', () => {
    const data = createTestVaultData([]);

    expect(
      createAccount(data, {
        issuer: '',
        name: 'user@example.com',
        encryptedSecret: 'secret',
        encryptedBlinder: 'blinder',
        commitment: 'commitment',
      }).success
    ).toBe(false);

    expect(
      createAccount(data, {
        issuer: 'GitHub',
        name: '',
        encryptedSecret: 'secret',
        encryptedBlinder: 'blinder',
        commitment: 'commitment',
      }).success
    ).toBe(false);
  });

  it('should not mutate original data', () => {
    const data = createTestVaultData([]);
    const originalLength = data.accounts.length;

    createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });

    expect(data.accounts.length).toBe(originalLength);
  });
});

describe('deleteAccount', () => {
  it('should delete an existing account', () => {
    const account = createTestEncryptedAccount({ id: 'target-id' });
    const data = createTestVaultData([account]);

    const result = deleteAccount(data, 'target-id');

    expect(result.success).toBe(true);
    expect(result.data?.data.accounts).toHaveLength(0);
    expect(result.data?.deletedAccount.id).toBe('target-id');
  });

  it('should preserve other accounts', () => {
    const accounts = [
      createTestEncryptedAccount({ id: 'id-1' }),
      createTestEncryptedAccount({ id: 'id-2' }),
      createTestEncryptedAccount({ id: 'id-3' }),
    ];
    const data = createTestVaultData(accounts);

    const result = deleteAccount(data, 'id-2');

    expect(result.data?.data.accounts).toHaveLength(2);
    expect(result.data?.data.accounts.map((a) => a.account.id)).toEqual(['id-1', 'id-3']);
  });

  it('should fail for non-existent account', () => {
    const account = createTestEncryptedAccount({ id: 'other-id' });
    const data = createTestVaultData([account]);

    const result = deleteAccount(data, 'target-id');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Account not found');
  });

  it('should fail for empty account ID', () => {
    const data = createTestVaultData([]);

    expect(deleteAccount(data, '').success).toBe(false);
    expect(deleteAccount(data, '').error).toBe('Account ID is required');
  });

  it('should not mutate original data', () => {
    const account = createTestEncryptedAccount({ id: 'target-id' });
    const data = createTestVaultData([account]);
    const originalLength = data.accounts.length;

    deleteAccount(data, 'target-id');

    expect(data.accounts.length).toBe(originalLength);
  });
});

describe('touchAccount', () => {
  it('should update lastUsedAt timestamp', () => {
    const account = createTestEncryptedAccount({ id: 'target-id' });
    const data = createTestVaultData([account]);

    const before = Date.now();
    const result = touchAccount(data, 'target-id');
    const after = Date.now();

    expect(result.success).toBe(true);
    const updatedAccount = result.data?.accounts.find((a) => a.account.id === 'target-id');
    expect(updatedAccount?.account.lastUsedAt).toBeGreaterThanOrEqual(before);
    expect(updatedAccount?.account.lastUsedAt).toBeLessThanOrEqual(after);
  });

  it('should fail for non-existent account', () => {
    const data = createTestVaultData([]);
    const result = touchAccount(data, 'non-existent');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Account not found');
  });

  it('should not mutate original data', () => {
    const account = createTestEncryptedAccount({ id: 'target-id' });
    const data = createTestVaultData([account]);
    const originalLastUsed = data.accounts[0]?.account.lastUsedAt;

    touchAccount(data, 'target-id');

    expect(data.accounts[0]?.account.lastUsedAt).toBe(originalLastUsed);
  });
});

describe('sortAccounts', () => {
  const accounts: Account[] = [
    createTestAccount({ id: '1', issuer: 'Zebra', name: 'alpha', createdAt: 100 }),
    createTestAccount({ id: '2', issuer: 'Apple', name: 'gamma', createdAt: 300 }),
    createTestAccount({ id: '3', issuer: 'Mango', name: 'beta', createdAt: 200 }),
  ];

  it('should sort by issuer ascending (default)', () => {
    const sorted = sortAccounts(accounts);
    expect(sorted.map((a) => a.issuer)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('should sort by issuer descending', () => {
    const sorted = sortAccounts(accounts, 'issuer', 'desc');
    expect(sorted.map((a) => a.issuer)).toEqual(['Zebra', 'Mango', 'Apple']);
  });

  it('should sort by name', () => {
    const sorted = sortAccounts(accounts, 'name', 'asc');
    expect(sorted.map((a) => a.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('should sort by createdAt', () => {
    const sorted = sortAccounts(accounts, 'createdAt', 'asc');
    expect(sorted.map((a) => a.createdAt)).toEqual([100, 200, 300]);
  });

  it('should sort by lastUsedAt', () => {
    const withLastUsed = [
      createTestAccount({ id: '1', lastUsedAt: 500 }),
      createTestAccount({ id: '2', lastUsedAt: 100 }),
      createTestAccount({ id: '3', lastUsedAt: 300 }),
    ];
    const sorted = sortAccounts(withLastUsed, 'lastUsedAt', 'desc');
    expect(sorted.map((a) => a.lastUsedAt)).toEqual([500, 300, 100]);
  });

  it('should handle missing lastUsedAt as 0', () => {
    const mixed = [
      createTestAccount({ id: '1', lastUsedAt: 100 }),
      createTestAccount({ id: '2', lastUsedAt: undefined }),
      createTestAccount({ id: '3', lastUsedAt: 50 }),
    ];
    const sorted = sortAccounts(mixed, 'lastUsedAt', 'asc');
    expect(sorted.map((a) => a.lastUsedAt)).toEqual([undefined, 50, 100]);
  });

  it('should not mutate original array', () => {
    const original = [...accounts];
    sortAccounts(accounts, 'name', 'desc');
    expect(accounts.map((a) => a.id)).toEqual(original.map((a) => a.id));
  });
});

describe('filterAccounts', () => {
  const accounts: Account[] = [
    createTestAccount({ issuer: 'GitHub', name: 'work@company.com' }),
    createTestAccount({ issuer: 'GitLab', name: 'personal@gmail.com' }),
    createTestAccount({ issuer: 'AWS', name: 'admin@company.com' }),
  ];

  it('should filter by issuer', () => {
    const filtered = filterAccounts(accounts, 'git');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.issuer)).toContain('GitHub');
    expect(filtered.map((a) => a.issuer)).toContain('GitLab');
  });

  it('should filter by name', () => {
    const filtered = filterAccounts(accounts, 'company');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.name)).toContain('work@company.com');
    expect(filtered.map((a) => a.name)).toContain('admin@company.com');
  });

  it('should be case-insensitive', () => {
    expect(filterAccounts(accounts, 'GITHUB')).toHaveLength(1);
    expect(filterAccounts(accounts, 'github')).toHaveLength(1);
    expect(filterAccounts(accounts, 'GitHub')).toHaveLength(1);
  });

  it('should trim whitespace', () => {
    expect(filterAccounts(accounts, '  git  ')).toHaveLength(2);
  });

  it('should return all accounts for empty query', () => {
    expect(filterAccounts(accounts, '')).toHaveLength(3);
    expect(filterAccounts(accounts, '   ')).toHaveLength(3);
  });

  it('should return empty array for no matches', () => {
    expect(filterAccounts(accounts, 'nonexistent')).toHaveLength(0);
  });

  it('should not mutate original array', () => {
    const original = [...accounts];
    filterAccounts(accounts, 'git');
    expect(accounts).toEqual(original);
  });
});

describe('integration: multiple operations', () => {
  it('should handle create -> delete flow', () => {
    let data = createTestVaultData([]);

    // Create account
    const createResult = createAccount(data, {
      issuer: 'GitHub',
      name: 'user@example.com',
      encryptedSecret: 'secret',
      encryptedBlinder: 'blinder',
      commitment: 'commitment',
    });
    expect(createResult.success).toBe(true);
    data = createResult.data!.data;
    const accountId = createResult.data!.account.id;

    // Verify account exists
    expect(getAllAccounts(data)).toHaveLength(1);

    // Delete account
    const deleteResult = deleteAccount(data, accountId);
    expect(deleteResult.success).toBe(true);
    data = deleteResult.data!.data;

    // Verify account is gone
    expect(getAllAccounts(data)).toHaveLength(0);
  });

  it('should handle multiple accounts', () => {
    let data = createTestVaultData([]);

    // Create 5 accounts
    for (let i = 0; i < 5; i++) {
      const result = createAccount(data, {
        issuer: `Service ${i}`,
        name: `user${i}@example.com`,
        encryptedSecret: `secret-${i}`,
        encryptedBlinder: `blinder-${i}`,
        commitment: `commitment-${i}`,
      });
      expect(result.success).toBe(true);
      data = result.data!.data;
    }

    expect(getAllAccounts(data)).toHaveLength(5);

    // Delete middle account
    const accounts = getAllAccounts(data);
    const deleteResult = deleteAccount(data, accounts[2].id);
    expect(deleteResult.success).toBe(true);
    data = deleteResult.data!.data;

    expect(getAllAccounts(data)).toHaveLength(4);
  });
});
