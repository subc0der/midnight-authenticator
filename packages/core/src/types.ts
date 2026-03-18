/**
 * Core type definitions for Midnight Authenticator
 */

/**
 * A registered TOTP account
 */
export interface Account {
  /** Unique identifier (32 bytes, hex encoded) */
  id: string;
  /** Display name for the account */
  name: string;
  /** Service/issuer name (e.g., "GitHub", "Google") */
  issuer: string;
  /** On-chain commitment hash */
  commitment: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last authentication timestamp */
  lastUsedAt?: number;
}

/**
 * Encrypted account data stored in vault
 */
export interface EncryptedAccount {
  /** Account metadata (not encrypted) */
  account: Account;
  /** Encrypted secret (Argon2id + AES-256-GCM) */
  encryptedSecret: string;
  /** Encrypted blinder */
  encryptedBlinder: string;
}

/**
 * Authentication request from dApp
 */
export interface AuthRequest {
  /** Account to authenticate with */
  accountId: string;
  /** Optional challenge from verifier */
  challenge?: string;
  /** Request origin (set by extension, not dApp) */
  origin: string;
  /** Request timestamp */
  timestamp: number;
  /** Request expiration */
  expiresAt: number;
}

/**
 * Authentication result
 */
export interface AuthResult {
  success: boolean;
  /** ZK proof (if success) */
  proof?: string;
  /** Transaction hash (if submitted) */
  txHash?: string;
  /** Error message (if failed) */
  error?: string;
  /** Whether this is a mock proof (development only) */
  isMock?: boolean;
}

/**
 * Network configuration
 */
export interface NetworkConfig {
  networkId: 'preprod' | 'mainnet';
  indexerUri: string;
  indexerWsUri: string;
  nodeUri: string;
  proofServerUri: string;
}

/**
 * Vault status
 */
export interface VaultStatus {
  /** Whether vault has been initialized */
  exists: boolean;
  /** Whether vault is currently unlocked */
  unlocked: boolean;
}
