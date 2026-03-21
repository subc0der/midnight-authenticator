/**
 * Tests for base32 encoding/decoding
 */
import { describe, it, expect } from 'vitest';
import { fromBase32, toBase32, isValidBase32 } from '../base32';

describe('fromBase32', () => {
  describe('valid inputs', () => {
    it('should decode standard base32 strings', () => {
      // "Hello" in base32 is "JBSWY3DP"
      const result = fromBase32('JBSWY3DP');
      expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]); // "Hello"
    });

    it('should decode lowercase input', () => {
      const upper = fromBase32('JBSWY3DP');
      const lower = fromBase32('jbswy3dp');
      expect(Array.from(upper)).toEqual(Array.from(lower));
    });

    it('should decode mixed case input', () => {
      const result = fromBase32('JbSwY3Dp');
      expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]);
    });

    it('should handle padding characters', () => {
      // With padding
      const withPadding = fromBase32('ME======');
      // Without padding
      const withoutPadding = fromBase32('ME');
      expect(Array.from(withPadding)).toEqual(Array.from(withoutPadding));
      expect(Array.from(withPadding)).toEqual([97]); // 'a'
    });

    it('should handle whitespace', () => {
      const withSpaces = fromBase32('JBSW Y3DP');
      const withNewlines = fromBase32('JBSWY3DP\n');
      const withTabs = fromBase32('\tJBSWY3DP');
      const clean = fromBase32('JBSWY3DP');

      expect(Array.from(withSpaces)).toEqual(Array.from(clean));
      expect(Array.from(withNewlines)).toEqual(Array.from(clean));
      expect(Array.from(withTabs)).toEqual(Array.from(clean));
    });

    it('should return empty array for empty string', () => {
      const result = fromBase32('');
      expect(result.length).toBe(0);
    });

    it('should decode 32-byte TOTP secrets', () => {
      // 32 bytes encoded = 52 base32 chars (ceil(32 * 8 / 5))
      const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
      const result = fromBase32(secret);
      expect(result.length).toBe(32);
    });

    it('should decode various lengths correctly', () => {
      // 1 byte
      expect(fromBase32('ME').length).toBe(1);
      // 2 bytes
      expect(fromBase32('MFRA').length).toBe(2);
      // 5 bytes
      expect(fromBase32('MFRGGZDF').length).toBe(5);
      // 10 bytes
      expect(fromBase32('MFRGGZDFMY2TQNZV').length).toBe(10);
    });
  });

  describe('invalid inputs', () => {
    it('should throw on invalid characters', () => {
      expect(() => fromBase32('INVALID!')).toThrow('Invalid base32 character');
      expect(() => fromBase32('ABC123')).toThrow(); // 1 is not valid base32
      expect(() => fromBase32('HELLO0')).toThrow(); // 0 is not valid base32
      expect(() => fromBase32('TEST8')).toThrow(); // 8 is not valid base32
      expect(() => fromBase32('TEST9')).toThrow(); // 9 is not valid base32
    });

    it('should include invalid character in error message', () => {
      expect(() => fromBase32('ABC!')).toThrow("Invalid base32 character: '!'");
    });
  });
});

describe('toBase32', () => {
  it('should encode bytes to base32', () => {
    // "Hello" = [72, 101, 108, 108, 111]
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(toBase32(bytes)).toBe('JBSWY3DP');
  });

  it('should return empty string for empty input', () => {
    expect(toBase32(new Uint8Array(0))).toBe('');
  });

  it('should encode single byte', () => {
    expect(toBase32(new Uint8Array([97]))).toBe('ME'); // 'a'
  });

  it('should encode 32 random bytes', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = i;
    }
    const encoded = toBase32(bytes);
    // 32 bytes = 52 base32 chars (ceil(32 * 8 / 5))
    expect(encoded.length).toBe(52);
    // Should only contain valid base32 chars
    expect(isValidBase32(encoded)).toBe(true);
  });
});

describe('round-trip encoding', () => {
  it('should preserve data through encode/decode cycle', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const encoded = toBase32(original);
    const decoded = fromBase32(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('should preserve 32-byte secrets', () => {
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);

    const encoded = toBase32(secret);
    const decoded = fromBase32(encoded);

    expect(Array.from(decoded)).toEqual(Array.from(secret));
  });

  it('should handle all byte values', () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i;
    }

    const encoded = toBase32(allBytes);
    const decoded = fromBase32(encoded);

    expect(Array.from(decoded)).toEqual(Array.from(allBytes));
  });
});

describe('isValidBase32', () => {
  it('should return true for valid base32', () => {
    expect(isValidBase32('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toBe(true);
    expect(isValidBase32('JBSWY3DP')).toBe(true);
    expect(isValidBase32('jbswy3dp')).toBe(true);
    expect(isValidBase32('')).toBe(true);
  });

  it('should return true for padded input', () => {
    expect(isValidBase32('ME======')).toBe(true);
    expect(isValidBase32('MFRA====')).toBe(true);
  });

  it('should return true for input with whitespace', () => {
    expect(isValidBase32('JBSW Y3DP')).toBe(true);
    expect(isValidBase32(' JBSWY3DP ')).toBe(true);
    expect(isValidBase32('JBSWY3DP\n')).toBe(true);
  });

  it('should return false for invalid characters', () => {
    expect(isValidBase32('HELLO0')).toBe(false); // 0 invalid
    expect(isValidBase32('HELLO1')).toBe(false); // 1 invalid
    expect(isValidBase32('HELLO8')).toBe(false); // 8 invalid
    expect(isValidBase32('HELLO9')).toBe(false); // 9 invalid
    expect(isValidBase32('HELLO!')).toBe(false);
    expect(isValidBase32('HELLO@')).toBe(false);
  });
});

describe('edge cases', () => {
  it('should handle only whitespace', () => {
    expect(fromBase32('   ').length).toBe(0);
    expect(isValidBase32('   ')).toBe(true);
  });

  it('should handle only padding', () => {
    expect(fromBase32('======').length).toBe(0);
    expect(isValidBase32('======')).toBe(true);
  });

  it('should handle very long strings', () => {
    // 1000 bytes
    const longBytes = new Uint8Array(1000);
    crypto.getRandomValues(longBytes);

    const encoded = toBase32(longBytes);
    const decoded = fromBase32(encoded);

    expect(decoded.length).toBe(1000);
    expect(Array.from(decoded)).toEqual(Array.from(longBytes));
  });
});
