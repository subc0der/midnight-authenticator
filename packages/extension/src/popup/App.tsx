import React, { useState, useEffect } from 'react';

type AppState = 'loading' | 'locked' | 'unlocked' | 'setup';

// Password strength validation (Gemini Review #2: Medium Priority)
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
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

  return null; // Password is valid
}

export function App() {
  const [state, setState] = useState<AppState>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    checkVaultStatus();
  }, []);

  async function checkVaultStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_VAULT_STATUS' });
      if (response?.exists) {
        setState(response.unlocked ? 'unlocked' : 'locked');
      } else {
        setState('setup');
      }
    } catch (err) {
      setError('Failed to connect to extension');
      setState('setup');
    }
  }

  async function handleCreateVault() {
    setError(null);

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      setError(strengthError);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsProcessing(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'INIT_VAULT',
        password,
      });

      if (response?.success) {
        setPassword('');
        setConfirmPassword('');
        setState('unlocked');
      } else {
        setError(response?.error || 'Failed to create vault');
      }
    } catch (err) {
      setError('Failed to create vault');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleUnlock() {
    setError(null);

    if (!password) {
      setError('Please enter your password');
      return;
    }

    setIsProcessing(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UNLOCK_VAULT',
        password,
      });

      if (response?.success) {
        setPassword('');
        setState('unlocked');
      } else {
        setError(response?.error || 'Incorrect password');
      }
    } catch (err) {
      setError('Failed to unlock vault');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleLock() {
    await chrome.runtime.sendMessage({ type: 'LOCK_VAULT' });
    setState('locked');
  }

  if (state === 'loading') {
    return (
      <div className="container">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (state === 'setup') {
    return (
      <div className="container">
        <h1>Midnight Authenticator</h1>
        <p>Create a password to secure your vault.</p>
        <input
          type="password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isProcessing}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={isProcessing}
        />
        <button
          onClick={handleCreateVault}
          disabled={isProcessing}
          aria-busy={isProcessing}
        >
          {isProcessing ? 'Creating...' : 'Create Vault'}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <div className="container">
        <h1>Midnight Authenticator</h1>
        <p>Enter your password to unlock.</p>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          disabled={isProcessing}
        />
        <button
          onClick={handleUnlock}
          disabled={isProcessing}
          aria-busy={isProcessing}
        >
          {isProcessing ? 'Unlocking...' : 'Unlock'}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Midnight Authenticator</h1>
        <button className="lock-button" onClick={handleLock} title="Lock vault">
          Lock
        </button>
      </div>
      <p className="status">Ready</p>
      <div className="accounts">
        <p className="empty">No accounts yet. Add one to get started.</p>
      </div>
      <button>Add Account</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
