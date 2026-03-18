/**
 * Offscreen document for computations requiring WASM
 *
 * Service workers have CSP restrictions that prevent WASM execution.
 * This offscreen document runs Argon2id key derivation for the vault.
 */

import { argon2id } from 'hash-wasm';

// Argon2 parameters (OWASP recommended minimums)
const ARGON2_MEMORY = 65536; // 64 MB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32; // 256 bits for AES-256

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

chrome.runtime.onMessage.addListener(
  (message: DeriveKeyMessage, _sender, sendResponse) => {
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

console.log('[Offscreen] Midnight Authenticator offscreen document ready');
