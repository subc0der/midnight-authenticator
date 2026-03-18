/**
 * Cryptographic utilities for Midnight Authenticator
 *
 * Note: These are client-side utilities. The actual ZK operations
 * happen in Compact contracts via Midnight SDK.
 */

/**
 * Generate a cryptographically secure random secret (32 bytes)
 */
export function generateSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Generate a random blinder for commitments (32 bytes)
 */
export function generateBlinder(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Generate a unique account ID (32 bytes)
 */
export function generateAccountId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Get current time window (30-second intervals since epoch)
 */
export function getCurrentTimeWindow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000 / 30));
}

/**
 * Get seconds remaining in current time window
 */
export function getSecondsRemaining(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

/**
 * Convert Uint8Array to hex string
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Compute display code from auth code hash
 * Takes first 4 bytes and converts to 6-digit number
 *
 * Note: This is for UX only - the actual auth is the ZK proof
 */
export function computeDisplayCode(authCodeHash: Uint8Array): string {
  // Use first 4 bytes to get a number
  const view = new DataView(authCodeHash.buffer);
  const num = view.getUint32(0) % 1000000;
  return num.toString().padStart(6, '0');
}
