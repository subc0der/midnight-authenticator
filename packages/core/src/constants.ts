/**
 * Constants for Midnight Authenticator
 */

/**
 * Network configurations
 */
export const NETWORKS = {
  preprod: {
    networkId: 'preprod' as const,
    indexerUri: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWsUri: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    nodeUri: 'https://rpc.preprod.midnight.network',
    proofServerUri: 'https://lace-proof-pub.preprod.midnight.network',
  },
  mainnet: {
    networkId: 'mainnet' as const,
    indexerUri: 'https://indexer.midnight.network/api/v3/graphql',
    indexerWsUri: 'wss://indexer.midnight.network/api/v3/graphql/ws',
    nodeUri: 'https://rpc.midnight.network',
    proofServerUri: 'https://proof.midnight.network', // TBD
  },
} as const;

/**
 * Time constants
 */
export const TIME = {
  /** TOTP time window in seconds */
  TIME_WINDOW_SECONDS: 30,
  /** Request timeout in milliseconds */
  REQUEST_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
  /** Auto-lock timeout in milliseconds */
  AUTO_LOCK_MS: 5 * 60 * 1000, // 5 minutes
  /** Proof generation expected time in seconds */
  PROOF_TIME_SECONDS: 5,
} as const;

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  VAULT: 'vault',
  ACCOUNTS: 'accounts',
  SETTINGS: 'settings',
  REQUEST_QUEUE: 'requestQueue',
} as const;

/**
 * Development flags
 */
export const DEV = {
  /** Allow mock proofs (MUST be false in production) */
  ALLOW_MOCK_PROOFS: true,
} as const;
