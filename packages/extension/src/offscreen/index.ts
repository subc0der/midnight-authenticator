/**
 * Offscreen document for computations requiring DOM/WASM
 *
 * This runs in an offscreen document context where:
 * - WASM is allowed (service workers have CSP restrictions)
 * - DOM APIs like `document` are available (SDK compatibility)
 *
 * Handles:
 * - Argon2id key derivation
 * - Midnight SDK ZK proof generation (authenticate circuit)
 */

import { argon2id } from 'hash-wasm';
import type {
  GenerateAuthProofMessage,
  GenerateAuthProofResponse,
  CheckProofAvailabilityMessage,
  CheckProofAvailabilityResponse,
  ServiceUris,
} from '../shared/proof/types.js';

// Argon2 parameters (OWASP recommended minimums)
const ARGON2_MEMORY = 65536; // 64 MB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32; // 256 bits for AES-256

// === Message Types ===

interface DeriveKeyMessage {
  type: 'DERIVE_KEY';
  password: string;
  salt: number[];
}

interface DeriveKeyResponse {
  success: boolean;
  keyBytes?: number[];
  error?: string;
}

// === Proof Generation State ===

let proofProviderInitialized = false;
let zkConfigProvider: unknown = null;
let proofProvider: unknown = null;
let lastServiceUris: ServiceUris | null = null;

type OffscreenMessage = DeriveKeyMessage | GenerateAuthProofMessage | CheckProofAvailabilityMessage;

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener(
  (message: OffscreenMessage, _sender, sendResponse) => {
    if (message.type === 'DERIVE_KEY') {
      deriveKey(message.password, message.salt)
        .then((keyBytes) => {
          const response: DeriveKeyResponse = {
            success: true,
            keyBytes: Array.from(keyBytes),
          };
          sendResponse(response);
        })
        .catch((err) => {
          const response: DeriveKeyResponse = {
            success: false,
            error: (err as Error).message,
          };
          sendResponse(response);
        });

      return true; // Keep channel open for async response
    }

    if (message.type === 'GENERATE_AUTH_PROOF') {
      generateAuthProof(message)
        .then((result) => {
          const response: GenerateAuthProofResponse = {
            type: 'GENERATE_AUTH_PROOF_RESULT',
            success: true,
            proof: result.proof,
            isVerified: result.isVerified,
            isMock: result.isMock,
          };
          sendResponse(response);
        })
        .catch((err) => {
          const response: GenerateAuthProofResponse = {
            type: 'GENERATE_AUTH_PROOF_RESULT',
            success: false,
            isMock: false,
            error: (err as Error).message,
          };
          sendResponse(response);
        });

      return true;
    }

    if (message.type === 'CHECK_PROOF_AVAILABILITY') {
      checkProofAvailability(message.serviceUris)
        .then((available) => {
          const response: CheckProofAvailabilityResponse = {
            type: 'CHECK_PROOF_AVAILABILITY_RESULT',
            available,
          };
          sendResponse(response);
        })
        .catch((err) => {
          const response: CheckProofAvailabilityResponse = {
            type: 'CHECK_PROOF_AVAILABILITY_RESULT',
            available: false,
            error: (err as Error).message,
          };
          sendResponse(response);
        });

      return true;
    }
  }
);

async function deriveKey(password: string, saltArray: number[]): Promise<Uint8Array> {
  const salt = new Uint8Array(saltArray);

  console.log('[Offscreen] Deriving key with Argon2id...');

  const hashHex = await argon2id({
    password,
    salt,
    memorySize: ARGON2_MEMORY,
    iterations: ARGON2_ITERATIONS,
    parallelism: ARGON2_PARALLELISM,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: 'hex',
  });

  console.log('[Offscreen] Key derived successfully');

  // Convert hex string to Uint8Array
  const keyBytes = new Uint8Array(
    hashHex.match(/.{2}/g)!.map((byte: string) => parseInt(byte, 16))
  );

  return keyBytes;
}

// === Proof Generation ===

/**
 * Get the URL where circuit assets are hosted.
 *
 * For real ZK proof generation, circuit files (ZKIR, prover keys) must be
 * served over HTTP/HTTPS. The Midnight SDK doesn't support chrome-extension:// URLs.
 *
 * Development Setup:
 * 1. Run the demo app: `cd apps/demo && pnpm dev`
 * 2. Demo app serves circuits at http://localhost:3000/circuits/totp-verifier/
 * 3. Extension automatically uses this URL for proof generation
 *
 * Production Setup:
 * - Set CIRCUIT_ASSETS_URL at build time, OR
 * - Host circuits on a CDN and configure localStorage override
 */
function getCircuitAssetsUrl(serviceUris: ServiceUris): string {
  // Check ServiceUris first (passed from HttpProofProvider)
  if (serviceUris.circuitAssetsUrl) {
    return serviceUris.circuitAssetsUrl;
  }

  // Check for environment variable (set during build)
  // @ts-expect-error - injected at build time
  if (typeof CIRCUIT_ASSETS_URL !== 'undefined' && CIRCUIT_ASSETS_URL) {
    // @ts-expect-error - injected at build time
    return CIRCUIT_ASSETS_URL;
  }

  // Check localStorage for development/production override
  const override = localStorage.getItem('MIDNIGHT_AUTH_CIRCUIT_URL');
  if (override) {
    return override;
  }

  // Development default: demo app serves circuits
  const devUrl = 'http://localhost:3000/circuits/totp-verifier/';
  console.log('[Offscreen] Using development circuit URL:', devUrl);
  return devUrl;
}

/**
 * Check if the proof server is reachable.
 */
async function checkProofServerHealth(proverServerUri: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${proverServerUri}/version`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if circuit assets are accessible.
 */
async function checkCircuitAssets(circuitUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Try to fetch the authenticate circuit ZKIR file
    const response = await fetch(`${circuitUrl}zkir/authenticate.zkir`, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if proof generation is available.
 */
async function checkProofAvailability(serviceUris: ServiceUris): Promise<boolean> {
  const circuitUrl = getCircuitAssetsUrl(serviceUris);

  console.log('[Offscreen] Checking proof availability...');
  console.log('[Offscreen] Proof server:', serviceUris.proverServerUri);
  console.log('[Offscreen] Circuit URL:', circuitUrl);

  const [serverOk, circuitsOk] = await Promise.all([
    checkProofServerHealth(serviceUris.proverServerUri),
    checkCircuitAssets(circuitUrl),
  ]);

  console.log('[Offscreen] Proof server available:', serverOk);
  console.log('[Offscreen] Circuit assets available:', circuitsOk);

  return serverOk && circuitsOk;
}

async function initializeProofProvider(serviceUris: ServiceUris): Promise<void> {
  // Check if already initialized with same URIs
  if (
    proofProviderInitialized &&
    proofProvider &&
    lastServiceUris?.proverServerUri === serviceUris.proverServerUri &&
    lastServiceUris?.circuitAssetsUrl === serviceUris.circuitAssetsUrl
  ) {
    console.log('[Offscreen] Proof provider already initialized');
    return;
  }

  console.log('[Offscreen] Initializing Midnight SDK proof provider...');
  console.log('[Offscreen] Prover server URI:', serviceUris.proverServerUri);

  const circuitUrl = getCircuitAssetsUrl(serviceUris);
  console.log('[Offscreen] Circuit assets URL:', circuitUrl);

  try {
    // Dynamic imports work in offscreen document (has DOM context)
    const [zkConfigModule, proofProviderModule] = await Promise.all([
      import('@midnight-ntwrk/midnight-js-fetch-zk-config-provider'),
      import('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    ]);

    const { FetchZkConfigProvider } = zkConfigModule;
    const { httpClientProofProvider } = proofProviderModule;

    // Create ZK config provider for loading circuit keys
    // Generic type parameter matches circuit names in the contract
    zkConfigProvider = new FetchZkConfigProvider<'authenticate' | 'registerAccount' | 'isRegistered'>(
      circuitUrl,
      fetch.bind(window)
    );

    // Create HTTP client proof provider
    proofProvider = httpClientProofProvider(
      serviceUris.proverServerUri,
      zkConfigProvider as Parameters<typeof httpClientProofProvider>[1]
    );

    proofProviderInitialized = true;
    lastServiceUris = serviceUris;
    console.log('[Offscreen] Midnight SDK initialized successfully');
  } catch (error) {
    console.error('[Offscreen] Failed to initialize Midnight SDK:', error);
    throw error;
  }
}

interface ProofResult {
  proof: number[];
  isVerified: boolean;
  isMock: boolean;
}

async function generateAuthProof(message: GenerateAuthProofMessage): Promise<ProofResult> {
  const { serviceUris, accountId, nonce, expectedTimeWindow, secret, blinder } = message;

  console.log('[Offscreen] Generating authentication proof...');
  console.log('[Offscreen] Public inputs:', {
    accountIdLength: accountId.length,
    nonce,
    expectedTimeWindow,
  });

  try {
    // Initialize if needed
    await initializeProofProvider(serviceUris);

    if (!proofProvider) {
      throw new Error('Proof provider not initialized');
    }

    // Convert inputs from number arrays back to Uint8Array
    const accountIdBytes = new Uint8Array(accountId);
    const secretBytes = new Uint8Array(secret);
    const blinderBytes = new Uint8Array(blinder);

    // Generate proof using SDK
    // The authenticate circuit has witnesses (getSecret, getBlinder) that provide private inputs
    const provider = proofProvider as {
      prove: (circuit: string, inputs: unknown) => Promise<{ proof: Uint8Array }>;
    };

    const proofResult = await provider.prove('authenticate', {
      // Public inputs (visible on-chain)
      publicInput: {
        accountId: accountIdBytes,
        nonce: BigInt(nonce),
        expectedTimeWindow: BigInt(expectedTimeWindow),
      },
      // Private inputs (witnesses - never revealed)
      privateInput: {
        secret: secretBytes,
        blinder: blinderBytes,
      },
    });

    console.log('[Offscreen] Proof generated successfully!');
    console.log('[Offscreen] Proof size:', proofResult.proof.length, 'bytes');

    return {
      proof: Array.from(proofResult.proof),
      isVerified: true, // If proof generation succeeds, authentication is valid
      isMock: false,
    };
  } catch (error) {
    console.error('[Offscreen] Proof generation failed:', error);
    throw error;
  }
}

console.log('[Offscreen] Midnight Authenticator offscreen document ready (with ZK proof support)');
