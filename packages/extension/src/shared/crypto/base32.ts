/**
 * Base32 encoding/decoding utilities (RFC 4648)
 *
 * Used for TOTP secret handling. Standard base32 alphabet: A-Z, 2-7
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode base32 string to Uint8Array
 *
 * Handles:
 * - Uppercase and lowercase input
 * - Padding characters (=)
 * - Whitespace (spaces, newlines)
 *
 * @throws Error if input contains invalid characters
 */
export function fromBase32(base32: string): Uint8Array {
  // Clean input: remove whitespace, uppercase, strip padding
  const cleaned = base32.replace(/\s/g, '').toUpperCase().replace(/=+$/, '');

  if (cleaned.length === 0) {
    return new Uint8Array(0);
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid base32 character: '${char}'`);
    }

    buffer = (buffer << 5) | val;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Encode Uint8Array to base32 string
 *
 * Returns uppercase base32 without padding.
 */
export function toBase32(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  let result = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      const index = (buffer >> bitsLeft) & 0x1f;
      result += BASE32_ALPHABET[index];
    }
  }

  // Handle remaining bits
  if (bitsLeft > 0) {
    const index = (buffer << (5 - bitsLeft)) & 0x1f;
    result += BASE32_ALPHABET[index];
  }

  return result;
}

/**
 * Validate that a string is valid base32
 *
 * Returns true if the string contains only valid base32 characters
 * (after removing whitespace and padding).
 */
export function isValidBase32(input: string): boolean {
  const cleaned = input.replace(/\s/g, '').toUpperCase().replace(/=+$/, '');

  if (cleaned.length === 0) {
    return true; // Empty is valid
  }

  for (const char of cleaned) {
    if (BASE32_ALPHABET.indexOf(char) === -1) {
      return false;
    }
  }

  return true;
}
