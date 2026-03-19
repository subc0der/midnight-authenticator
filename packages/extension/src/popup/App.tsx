import React, { useState, useEffect, useCallback } from 'react';

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

interface ZkAuthCode {
  code: string;
  remainingSeconds: number;
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
  const [authCodes, setAuthCodes] = useState<Record<string, ZkAuthCode>>({});
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [copiedAccount, setCopiedAccount] = useState<string | null>(null);

  // Add account form state
  const [issuer, setIssuer] = useState('');
  const [accountName, setAccountName] = useState('');
  const [secret, setSecret] = useState('');

  useEffect(() => {
    checkVaultStatus();
  }, []);

  // Keep service worker alive while popup is open and vault is unlocked
  // This prevents the SW from going dormant and losing the encryption key
  useEffect(() => {
    if (state !== 'unlocked') return;

    const keepAlive = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'KEEPALIVE' }).catch(() => {
        // SW may have died, check status
        checkVaultStatus();
      });
    }, 20000); // Ping every 20 seconds (SW dies at ~30s)

    return () => clearInterval(keepAlive);
  }, [state]);

  // Fetch TOTP code for an account
  const fetchAuthCode = useCallback(async (accountId: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_AUTH_CODE',
        accountId,
      });

      if (response?.success) {
        setAuthCodes((prev) => ({
          ...prev,
          [accountId]: {
            code: response.code,
            remainingSeconds: response.remainingSeconds,
          },
        }));
      } else if (response?.error === 'Vault is locked') {
        setState('locked');
        setError('Session expired. Please unlock again.');
      }
    } catch (err) {
      console.error('Failed to fetch TOTP code:', err);
    }
  }, []);

  // Countdown timer - updates every second
  useEffect(() => {
    if (state !== 'unlocked' || Object.keys(authCodes).length === 0) return;

    const timer = setInterval(() => {
      setAuthCodes((prev) => {
        const updated: Record<string, ZkAuthCode> = {};
        let needsRefresh = false;

        for (const [accountId, authCode] of Object.entries(prev)) {
          if (authCode.remainingSeconds <= 1) {
            needsRefresh = true;
            // Will be refreshed by the refresh effect
            updated[accountId] = { ...authCode, remainingSeconds: 0 };
          } else {
            updated[accountId] = { ...authCode, remainingSeconds: authCode.remainingSeconds - 1 };
          }
        }

        return updated;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state, Object.keys(authCodes).length]);

  // Refresh codes when they expire
  useEffect(() => {
    for (const [accountId, authCode] of Object.entries(authCodes)) {
      if (authCode.remainingSeconds === 0) {
        fetchAuthCode(accountId);
      }
    }
  }, [authCodes, fetchAuthCode]);

  // Fetch code when account is expanded
  useEffect(() => {
    if (expandedAccount && !authCodes[expandedAccount]) {
      fetchAuthCode(expandedAccount);
    }
  }, [expandedAccount, fetchAuthCode, authCodes]);

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
        // Transition to locked state so user enters password again
        // This ensures the encryption key is fresh in SW memory
        setState('locked');
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
      } else if (response?.error === 'Vault is locked') {
        // SW lost the key - redirect to unlock
        setState('locked');
        setView('list');
        setError('Session expired. Please unlock again.');
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
      } else if (response?.error === 'Vault is locked') {
        setState('locked');
        setError('Session expired. Please unlock again.');
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

  // Toggle account expansion and fetch code
  function handleAccountClick(accountId: string) {
    if (expandedAccount === accountId) {
      setExpandedAccount(null);
    } else {
      setExpandedAccount(accountId);
      if (!authCodes[accountId]) {
        fetchAuthCode(accountId);
      }
    }
  }

  // Copy code to clipboard
  async function handleCopyCode(code: string, accountId: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedAccount(accountId);
      setTimeout(() => setCopiedAccount(null), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  // Format code with space in middle (e.g., "123 456")
  function formatCode(code: string): string {
    if (code.length === 6) {
      return `${code.slice(0, 3)} ${code.slice(3)}`;
    }
    return code;
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
          accounts.map((account) => {
            const isExpanded = expandedAccount === account.id;
            const code = authCodes[account.id];

            return (
              <div
                key={account.id}
                className={`account-item ${isExpanded ? 'expanded' : ''}`}
              >
                <div
                  className="account-header"
                  onClick={() => handleAccountClick(account.id)}
                >
                  <div className="account-info">
                    <span className="account-issuer">{account.issuer}</span>
                    <span className="account-name">{account.name}</span>
                  </div>
                  <button
                    className="delete-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAccount(account.id);
                    }}
                    title="Delete account"
                  >
                    x
                  </button>
                </div>
                {isExpanded && (
                  <div className="auth-code-display">
                    {code ? (
                      <>
                        <div
                          className={`auth-code ${copiedAccount === account.id ? 'copied' : ''}`}
                          onClick={() => handleCopyCode(code.code, account.id)}
                          title="Click to copy"
                        >
                          {copiedAccount === account.id ? 'Copied!' : formatCode(code.code)}
                        </div>
                        <div className="auth-timer">
                          <div className="timer-bar-container">
                            <div
                              className="timer-bar"
                              style={{ width: `${(code.remainingSeconds / 30) * 100}%` }}
                            />
                          </div>
                          <span className="timer-text">{code.remainingSeconds}s</span>
                        </div>
                      </>
                    ) : (
                      <div className="auth-loading">Loading...</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <button onClick={() => setView('add')}>Add Account</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
