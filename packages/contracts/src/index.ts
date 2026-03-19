/**
 * @midnight-authenticator/contracts
 *
 * Compact smart contracts for Midnight Authenticator ZK authentication.
 *
 * This is a ZK-native authenticator using Midnight's persistentHash.
 * It is NOT RFC 6238 TOTP compatible.
 *
 * After compilation with `pnpm compile`, import the generated TypeScript API from:
 * - ./managed/totp-verifier/contract
 */

// Re-export contract module and pure circuits
export * as TotpVerifier from './managed/totp-verifier/contract/index.js';
export { pureCircuits } from './managed/totp-verifier/contract/index.js';

// Re-export witnesses
export * from './totp-verifier-witnesses.js';

// Contract addresses (populated after deployment)
export const CONTRACT_ADDRESSES = {
  preprod: {
    totpVerifier: '02b3255950655d5c3f2695692e8135c1c4119240c64a6abfe92bdafbc1751d66',
  },
  mainnet: {
    totpVerifier: '',
  },
} as const;

export type Network = keyof typeof CONTRACT_ADDRESSES;

/**
 * Get contract addresses for a specific network
 */
export function getContractAddresses(network: Network) {
  return CONTRACT_ADDRESSES[network];
}

/**
 * Check if contracts are deployed on a network
 */
export function areContractsDeployed(network: Network): boolean {
  const addresses = CONTRACT_ADDRESSES[network];
  return addresses.totpVerifier !== '';
}

/**
 * Network configuration for Midnight networks
 */
export const NETWORK_CONFIG = {
  preprod: {
    indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://faucet.preprod.midnight.network',
    explorer: 'https://preprod.midnightexplorer.io',
  },
  mainnet: {
    indexer: '',
    indexerWS: '',
    node: '',
    proofServer: '',
    faucet: '',
    explorer: '',
  },
} as const;

/**
 * Get network configuration
 */
export function getNetworkConfig(network: Network) {
  return NETWORK_CONFIG[network];
}

/**
 * Compute the current time window (30-second intervals since Unix epoch)
 */
export function getCurrentTimeWindow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000 / 30));
}

/**
 * Generate account ID from user identifier (simple XOR hash)
 * In production, integrate with proper crypto hash from Midnight SDK
 */
export function generateAccountId(userId: string): Uint8Array {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hash = new Uint8Array(32);
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    const idx = i % 32;
    const current = hash[idx];
    if (byte !== undefined && current !== undefined) {
      hash[idx] = current ^ byte;
    }
  }
  return hash;
}
