/**
 * Network configuration for Midnight Authenticator deployment.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const contractConfig = {
  privateStateStoreName: 'midnight-authenticator-private-state',
  totpVerifierZkPath: path.resolve(__dirname, '..', '..', 'contracts', 'src', 'managed', 'totp-verifier'),
};

export interface Config {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  /** Fee overhead for dust wallet. Preprod uses high value; tune down for mainnet. */
  readonly additionalFeeOverhead: bigint;
}

export class PreprodConfig implements Config {
  indexer = 'https://indexer.preprod.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  // High fee overhead for preprod - tune down significantly for mainnet
  additionalFeeOverhead = 300_000_000_000_000n;

  constructor() {
    setNetworkId('preprod');
  }
}
