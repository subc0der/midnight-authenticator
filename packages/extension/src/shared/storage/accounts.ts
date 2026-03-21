/**
 * Account management utilities
 *
 * Pure functions for account CRUD operations that can be tested independently.
 * These functions operate on VaultData structures without side effects.
 */

import type { Account, EncryptedAccount, VaultData } from './encrypted-storage';

export type { Account, EncryptedAccount };

/**
 * Result of an account operation
 */
export interface AccountResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Input for creating a new account
 */
export interface CreateAccountInput {
  issuer: string;
  name: string;
  encryptedSecret: string;
  encryptedBlinder: string;
  commitment: string;
  commitmentVersion?: number;
}

/**
 * Generate a unique account ID
 * Returns 32-character hex string (16 bytes)
 */
export function generateAccountId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate account input fields
 */
export function validateAccountInput(
  issuer: string | undefined,
  name: string | undefined
): AccountResult {
  if (!issuer?.trim()) {
    return { success: false, error: 'Service name is required' };
  }
  if (!name?.trim()) {
    return { success: false, error: 'Account name is required' };
  }
  if (issuer.trim().length > 100) {
    return { success: false, error: 'Service name too long (max 100 characters)' };
  }
  if (name.trim().length > 100) {
    return { success: false, error: 'Account name too long (max 100 characters)' };
  }
  return { success: true };
}

/**
 * Check if an account with the given ID exists
 */
export function accountExists(data: VaultData, accountId: string): boolean {
  return data.accounts.some((a) => a.account.id === accountId);
}

/**
 * Check if an account with the same issuer and name already exists
 */
export function findDuplicateAccount(
  data: VaultData,
  issuer: string,
  name: string
): EncryptedAccount | undefined {
  const normalizedIssuer = issuer.trim().toLowerCase();
  const normalizedName = name.trim().toLowerCase();
  return data.accounts.find(
    (a) =>
      a.account.issuer.toLowerCase() === normalizedIssuer &&
      a.account.name.toLowerCase() === normalizedName
  );
}

/**
 * Get an account by ID
 */
export function getAccountById(
  data: VaultData,
  accountId: string
): EncryptedAccount | undefined {
  return data.accounts.find((a) => a.account.id === accountId);
}

/**
 * Get all accounts (metadata only, no encrypted fields)
 */
export function getAllAccounts(data: VaultData): Account[] {
  return data.accounts.map((ea) => ea.account);
}

/**
 * Create a new account and add it to the vault data
 * Returns a new VaultData object (does not mutate input)
 */
export function createAccount(
  data: VaultData,
  input: CreateAccountInput
): AccountResult<{ data: VaultData; account: Account }> {
  // Validate input
  const validation = validateAccountInput(input.issuer, input.name);
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  // Check for duplicates
  const duplicate = findDuplicateAccount(data, input.issuer, input.name);
  if (duplicate) {
    return {
      success: false,
      error: `Account "${input.issuer} - ${input.name}" already exists`,
    };
  }

  // Generate unique ID (with collision check)
  let id: string;
  let attempts = 0;
  do {
    id = generateAccountId();
    attempts++;
    if (attempts > 10) {
      return { success: false, error: 'Failed to generate unique account ID' };
    }
  } while (accountExists(data, id));

  const account: Account = {
    id,
    name: input.name.trim(),
    issuer: input.issuer.trim(),
    commitment: input.commitment,
    commitmentVersion: input.commitmentVersion ?? 2,
    createdAt: Date.now(),
  };

  const encryptedAccount: EncryptedAccount = {
    account,
    encryptedSecret: input.encryptedSecret,
    encryptedBlinder: input.encryptedBlinder,
  };

  // Create new data object (immutable)
  const newData: VaultData = {
    ...data,
    accounts: [...data.accounts, encryptedAccount],
  };

  return {
    success: true,
    data: { data: newData, account },
  };
}

/**
 * Delete an account from the vault data
 * Returns a new VaultData object (does not mutate input)
 */
export function deleteAccount(
  data: VaultData,
  accountId: string
): AccountResult<{ data: VaultData; deletedAccount: Account }> {
  if (!accountId) {
    return { success: false, error: 'Account ID is required' };
  }

  const index = data.accounts.findIndex((a) => a.account.id === accountId);
  if (index === -1) {
    return { success: false, error: 'Account not found' };
  }

  const deletedAccount = data.accounts[index]!.account;

  // Create new data object (immutable)
  const newAccounts = [...data.accounts];
  newAccounts.splice(index, 1);

  const newData: VaultData = {
    ...data,
    accounts: newAccounts,
  };

  return {
    success: true,
    data: { data: newData, deletedAccount },
  };
}

/**
 * Update an account's lastUsedAt timestamp
 * Returns a new VaultData object (does not mutate input)
 */
export function touchAccount(
  data: VaultData,
  accountId: string
): AccountResult<VaultData> {
  const index = data.accounts.findIndex((a) => a.account.id === accountId);
  if (index === -1) {
    return { success: false, error: 'Account not found' };
  }

  const newAccounts = [...data.accounts];
  const existingAccount = newAccounts[index]!;
  newAccounts[index] = {
    ...existingAccount,
    account: {
      ...existingAccount.account,
      lastUsedAt: Date.now(),
    },
  };

  const newData: VaultData = {
    ...data,
    accounts: newAccounts,
  };

  return { success: true, data: newData };
}

/**
 * Sort accounts by various criteria
 */
export type AccountSortField = 'name' | 'issuer' | 'createdAt' | 'lastUsedAt';
export type AccountSortOrder = 'asc' | 'desc';

export function sortAccounts(
  accounts: Account[],
  field: AccountSortField = 'issuer',
  order: AccountSortOrder = 'asc'
): Account[] {
  const sorted = [...accounts].sort((a, b) => {
    let comparison: number;
    switch (field) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'issuer':
        comparison = a.issuer.localeCompare(b.issuer);
        break;
      case 'createdAt':
        comparison = a.createdAt - b.createdAt;
        break;
      case 'lastUsedAt':
        comparison = (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
        break;
      default:
        comparison = 0;
    }
    return order === 'desc' ? -comparison : comparison;
  });
  return sorted;
}

/**
 * Filter accounts by search query (matches issuer or name)
 */
export function filterAccounts(accounts: Account[], query: string): Account[] {
  if (!query.trim()) {
    return accounts;
  }
  const lowerQuery = query.toLowerCase().trim();
  return accounts.filter(
    (a) =>
      a.issuer.toLowerCase().includes(lowerQuery) ||
      a.name.toLowerCase().includes(lowerQuery)
  );
}
