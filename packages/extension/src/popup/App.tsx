import React, { useState, useEffect } from 'react';

type AppState = 'loading' | 'locked' | 'unlocked' | 'setup';
type UnlockedView = 'list' | 'add';

interface Account {
  id: string;
  name: string;
  issuer: string;
  commitment: string;
  createdAt: number;
  lastUsedAt?: number;
}

// Password strength validation
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

  return null;
}

export function App() {
  const [state, setState] = useState<AppState>('loading');
  const [view, setView] = useState<UnlockedView>('list');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Account state
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Add account form state
  const [issuer, setIssuer] = useState('');
  const [accountName, setAccountName] = useState('');
  const [secret, setSecret] = useState('');

  useEffect(() => {
    checkVaultStatus();
  }, []);

  async function checkVaultStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_VAULT_STATUS' });
      if (response?.exists) {
        if (response.unlocked) {
          setState('unlocked');
          loadAccounts();
        } else {
          setState('locked');
        }
      } else {
        setState('setup');
      }
    } catch (err) {
      setError('Failed to connect to extension');
      setState('setup');
    }
  }

  async function loadAccounts() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' });
      if (response?.success) {
        setAccounts(response.accounts || []);
      }
    } catch (err) {
      console.error('Failed to load accounts:', err);
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
        loadAccounts();
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
    setAccounts([]);
    setState('locked');
  }

  async function handleAddAccount() {
    setError(null);

    if (!issuer.trim() || !accountName.trim() || !secret.trim()) {
      setError('All fields are required');
      return;
    }

    setIsProcessing(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ADD_ACCOUNT',
        issuer: issuer.trim(),
        name: accountName.trim(),
        secret: secret.trim(),
      });

      if (response?.success) {
        setIssuer('');
        setAccountName('');
        setSecret('');
        setView('list');
        loadAccounts();
      } else {
        setError(response?.error || 'Failed to add account');
      }
    } catch (err) {
      setError('Failed to add account');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleDeleteAccount(accountId: string) {
    if (!window.confirm('Delete this account? This cannot be undone.')) {
      return;
    }

    setError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_ACCOUNT',
        accountId,
      });

      if (response?.success) {
        loadAccounts();
      } else {
        setError(response?.error || 'Failed to delete account');
      }
    } catch (err) {
      setError('Failed to delete account');
    }
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

  // Unlocked state - show list or add form
  if (view === 'add') {
    return (
      <div className="container">
        <div className="header">
          <button className="back-button" onClick={() => { setView('list'); setError(null); }}>
            Back
          </button>
          <h1>Add Account</h1>
        </div>
        <input
          type="text"
          placeholder="Issuer (e.g., GitHub)"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          disabled={isProcessing}
        />
        <input
          type="text"
          placeholder="Account name (e.g., user@example.com)"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          disabled={isProcessing}
        />
        <input
          type="text"
          placeholder="Secret key (base32)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={isProcessing}
        />
        <button
          onClick={handleAddAccount}
          disabled={isProcessing}
          aria-busy={isProcessing}
        >
          {isProcessing ? 'Adding...' : 'Add Account'}
        </button>
        <button
          className="secondary-button"
          onClick={() => { setView('list'); setError(null); }}
          disabled={isProcessing}
        >
          Cancel
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }

  // List view (default)
  return (
    <div className="container">
      <div className="header">
        <h1>Midnight Authenticator</h1>
        <button className="lock-button" onClick={handleLock} title="Lock vault">
          Lock
        </button>
      </div>
      <div className="accounts">
        {accounts.length === 0 ? (
          <p className="empty">No accounts yet. Add one to get started.</p>
        ) : (
          accounts.map((account) => (
            <div key={account.id} className="account-item">
              <div className="account-info">
                <span className="account-issuer">{account.issuer}</span>
                <span className="account-name">{account.name}</span>
              </div>
              <button
                className="delete-button"
                onClick={() => handleDeleteAccount(account.id)}
                title="Delete account"
              >
                x
              </button>
            </div>
          ))
        )}
      </div>
      <button onClick={() => setView('add')}>Add Account</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
