#!/usr/bin/env node
/**
 * TOTP Verifier Contract Deployment Script
 *
 * Deploys the Midnight Authenticator contract to Preprod.
 *
 * Prerequisites:
 * 1. Proof server running: docker run -d -p 6300:6300 midnightntwrk/proof-server:7.0.0 midnight-proof-server -v
 * 2. Wallet seed in MIDNIGHT_SEED environment variable (64 hex chars)
 * 3. tDUST in wallet (from https://faucet.preprod.midnight.network)
 *
 * Usage:
 *   MIDNIGHT_SEED="your64charhexseed..." pnpm deploy
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PreprodConfig } from './config.js';
import * as api from './api.js';
import { createInitialPrivateState } from '../../contracts/src/totp-verifier-witnesses.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(msg: string, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function success(msg: string) {
  log(`✓ ${msg}`, colors.green);
}

function error(msg: string) {
  log(`✗ ${msg}`, colors.red);
}

function info(msg: string) {
  log(`  ${msg}`, colors.dim);
}

async function checkProofServer(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/version`);
    if (response.ok) {
      const version = await response.text();
      success(`Proof server running (version: ${version.trim() || 'unknown'})`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function checkIndexer(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    if (response.ok) {
      success('Indexer available');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function loadSeedPhrase(): string | null {
  const seed = process.env['MIDNIGHT_SEED'];
  if (seed) {
    return seed.trim();
  }

  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/MIDNIGHT_SEED=["']?(.+?)["']?$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  const envLocalPath = path.join(PROJECT_ROOT, '.env.local');
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, 'utf-8');
    const match = envContent.match(/MIDNIGHT_SEED=["']?(.+?)["']?$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

async function main() {
  const DIV = '═'.repeat(60);
  console.log(`\n${DIV}`);
  log('  Midnight Authenticator - Contract Deployment', colors.cyan);
  console.log(`${DIV}\n`);

  const config = new PreprodConfig();

  log(`Network: preprod`, colors.dim);
  log(`Indexer: ${config.indexer}`, colors.dim);
  log(`Proof Server: ${config.proofServer}`, colors.dim);
  console.log();

  // Check prerequisites
  log('Checking prerequisites...', colors.cyan);

  const proofServerOk = await checkProofServer(config.proofServer);
  if (!proofServerOk) {
    error('Proof server not running');
    info('Start with: docker run -d -p 6300:6300 midnightntwrk/proof-server:7.0.0 midnight-proof-server -v');
    process.exit(1);
  }

  const indexerOk = await checkIndexer(config.indexer);
  if (!indexerOk) {
    error('Cannot reach indexer');
    info('Check your internet connection');
    process.exit(1);
  }

  // Check for seed
  const seed = loadSeedPhrase();
  if (!seed) {
    error('No wallet seed found');
    info('Set MIDNIGHT_SEED environment variable (64 hex characters)');
    info('Or add MIDNIGHT_SEED=... to .env or .env.local');
    process.exit(1);
  }
  success(`Seed phrase found (${seed.length} chars)`);

  // Check compiled contract exists
  const contractPath = path.join(PROJECT_ROOT, 'packages/contracts/src/managed/totp-verifier/contract/index.js');
  if (!fs.existsSync(contractPath)) {
    error('Contract not compiled');
    info('Run: pnpm --filter @midnight-authenticator/contracts build');
    process.exit(1);
  }
  success('Contract compiled');

  console.log(`\n${'-'.repeat(60)}`);
  log('\nStarting deployment...', colors.cyan);
  console.log();

  try {
    // Build wallet
    const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);

    // Configure providers
    console.log();
    const providers = await api.withStatus('Configuring providers', () =>
      api.configureTotpVerifierProviders(walletCtx, config)
    );

    // Create initial private state (dummy values for deployment)
    // Real private state will be set per-user in the extension
    const dummySecret = new Uint8Array(32);
    crypto.getRandomValues(dummySecret);
    const privateState = createInitialPrivateState(dummySecret);

    // Deploy contract
    console.log();
    const contract = await api.deployTotpVerifier(providers, privateState);

    const contractAddress = contract.deployTxData.public.contractAddress;

    // Save deployment result
    const resultPath = path.join(PROJECT_ROOT, 'deployment-result.json');
    const result = {
      totpVerifier: {
        address: contractAddress,
        deployedAt: new Date().toISOString(),
        network: 'preprod',
      },
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    success(`Deployment result saved to ${resultPath}`);

    // Update contract addresses in index.ts
    const indexPath = path.join(PROJECT_ROOT, 'packages/contracts/src/index.ts');
    let indexContent = fs.readFileSync(indexPath, 'utf-8');
    indexContent = indexContent.replace(
      /totpVerifier: ''/,
      `totpVerifier: '${contractAddress}'`
    );
    fs.writeFileSync(indexPath, indexContent);
    success('Updated CONTRACT_ADDRESSES in packages/contracts/src/index.ts');

    // Cleanup
    await walletCtx.wallet.stop();

    console.log(`\n${DIV}`);
    log('  Deployment Complete!', colors.green);
    console.log(`${DIV}\n`);
    log(`Contract Address: ${contractAddress}`, colors.cyan);
    console.log();
    info('Next steps:');
    info('1. Rebuild contracts: pnpm --filter @midnight-authenticator/contracts build');
    info('2. Rebuild extension: pnpm --filter @midnight-authenticator/extension build');
    info('3. Test the extension with the deployed contract');
    console.log();

  } catch (e: any) {
    console.log();
    error(`Deployment failed: ${e.message}`);
    if (e.cause) {
      info(`Cause: ${e.cause}`);
    }
    console.error(e.stack);
    process.exit(1);
  }
}

main().catch((e) => {
  error(`Unexpected error: ${e.message}`);
  console.error(e);
  process.exit(1);
});
