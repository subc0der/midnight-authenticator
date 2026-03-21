/**
 * Tests for password strength validation
 *
 * Password requirements:
 * - Minimum 8 characters
 * - At least 2 character types (lowercase, uppercase, digits, special)
 */
import { describe, it, expect } from 'vitest';

// Copy of the validation function (same logic used in popup and background)
function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters';
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  const typesPresent = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (typesPresent < 2) {
    return 'Password must include at least 2 of: lowercase, uppercase, numbers, special characters';
  }

  return null;
}

describe('Password Length Validation', () => {
  it('should reject empty password', () => {
    expect(validatePasswordStrength('')).toBe('Password must be at least 8 characters');
  });

  it('should reject short passwords', () => {
    expect(validatePasswordStrength('Ab1')).toBe('Password must be at least 8 characters');
    expect(validatePasswordStrength('1234567')).toBe('Password must be at least 8 characters');
  });

  it('should accept 8+ character passwords', () => {
    // Still needs character types, but length check passes
    const result = validatePasswordStrength('12345678');
    expect(result).not.toBe('Password must be at least 8 characters');
  });
});

describe('Password Character Type Validation', () => {
  it('should reject passwords with only one character type', () => {
    // Only lowercase
    expect(validatePasswordStrength('abcdefgh')).toContain('at least 2');
    // Only uppercase
    expect(validatePasswordStrength('ABCDEFGH')).toContain('at least 2');
    // Only digits
    expect(validatePasswordStrength('12345678')).toContain('at least 2');
    // Only special
    expect(validatePasswordStrength('!@#$%^&*')).toContain('at least 2');
  });

  it('should accept lowercase + uppercase', () => {
    expect(validatePasswordStrength('AbcdefgH')).toBeNull();
  });

  it('should accept lowercase + digits', () => {
    expect(validatePasswordStrength('abcd1234')).toBeNull();
  });

  it('should accept lowercase + special', () => {
    expect(validatePasswordStrength('abcdefg!')).toBeNull();
  });

  it('should accept uppercase + digits', () => {
    expect(validatePasswordStrength('ABCD1234')).toBeNull();
  });

  it('should accept uppercase + special', () => {
    expect(validatePasswordStrength('ABCDEFG!')).toBeNull();
  });

  it('should accept digits + special', () => {
    expect(validatePasswordStrength('1234567!')).toBeNull();
  });

  it('should accept passwords with 3+ character types', () => {
    expect(validatePasswordStrength('Abc12345')).toBeNull();
    expect(validatePasswordStrength('Abc1234!')).toBeNull();
  });

  it('should accept passwords with all 4 character types', () => {
    expect(validatePasswordStrength('Abc123!@')).toBeNull();
    expect(validatePasswordStrength('SecureP@ss1')).toBeNull();
  });
});

describe('Real-world Password Examples', () => {
  // Good passwords
  it('should accept typical strong passwords', () => {
    expect(validatePasswordStrength('MySecurePass123')).toBeNull();
    expect(validatePasswordStrength('hunter2!')).toBeNull();
    expect(validatePasswordStrength('P@ssw0rd')).toBeNull();
    expect(validatePasswordStrength('Test123!')).toBeNull();
  });

  // Bad passwords (too weak)
  it('should reject common weak patterns', () => {
    // Only lowercase + length ok
    expect(validatePasswordStrength('password')).toContain('at least 2');
    // Only digits
    expect(validatePasswordStrength('12345678')).toContain('at least 2');
    // Too short even with types
    expect(validatePasswordStrength('Ab1!')).toBe('Password must be at least 8 characters');
  });

  // Edge cases
  it('should handle unicode characters as special', () => {
    // Unicode counts as special character
    expect(validatePasswordStrength('password€')).toBeNull();
    expect(validatePasswordStrength('12345678é')).toBeNull();
  });
});
