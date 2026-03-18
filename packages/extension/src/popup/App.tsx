import React, { useState, useEffect } from 'react';

type AppState = 'loading' | 'locked' | 'unlocked' | 'setup';

export function App() {
  const [state, setState] = useState<AppState>('loading');
  const [error, setError] = useState<string | null>(null);

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
        <p>Welcome! Set up your vault to get started.</p>
        <button onClick={() => setState('unlocked')}>
          Create Vault
        </button>
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <div className="container">
        <h1>Midnight Authenticator</h1>
        <p>Enter your password to unlock.</p>
        <input type="password" placeholder="Password" />
        <button onClick={() => setState('unlocked')}>
          Unlock
        </button>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Midnight Authenticator</h1>
      <p className="status">Ready</p>
      <div className="accounts">
        <p className="empty">No accounts yet. Add one to get started.</p>
      </div>
      <button>Add Account</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
