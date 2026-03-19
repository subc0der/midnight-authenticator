import { useState, useEffect } from 'react';

interface MidnightAuthAPI {
  requestAuth: (request: { accountId: string; challenge?: string }) => Promise<AuthResult>;
  getProofProvider: () => Promise<ProofProviderResult>;
  getProofStatus: () => Promise<ProofStatusResult>;
  isAvailable: () => boolean;
}

interface AuthResult {
  success: boolean;
  proof?: number[];
  publicInputs?: {
    accountId: number[];
    nonce: string;
    expectedTimeWindow: string;
    result: boolean;
  };
  providerName?: string;
  isMock?: boolean;
  error?: string;
}

interface ProofProviderResult {
  success: boolean;
  provider?: string;
  description?: string;
  error?: string;
}

interface ProofStatusResult {
  success: boolean;
  status?: {
    activeProvider: string | null;
    proofServerAvailable: boolean;
    laceAvailable: boolean;
    mockEnabled: boolean;
  };
  error?: string;
}

declare global {
  interface Window {
    midnightAuth?: MidnightAuthAPI;
  }
}

type AppState = 'checking' | 'unavailable' | 'ready' | 'requesting' | 'success' | 'error';

export function App() {
  const [state, setState] = useState<AppState>('checking');
  const [accountId, setAccountId] = useState('');
  const [challenge, setChallenge] = useState('');
  const [result, setResult] = useState<AuthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofStatus, setProofStatus] = useState<ProofStatusResult['status'] | null>(null);

  useEffect(() => {
    checkExtension();
  }, []);

  async function checkExtension() {
    // Wait a bit for the extension to inject the API
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log('[Demo] Checking extension...', window.midnightAuth);

    if (window.midnightAuth?.isAvailable()) {
      console.log('[Demo] Extension available, loading proof status...');
      setState('ready');
      loadProofStatus();
    } else {
      console.log('[Demo] Extension not available');
      setState('unavailable');
    }
  }

  async function loadProofStatus() {
    try {
      console.log('[Demo] Calling getProofStatus...');
      const result = await window.midnightAuth?.getProofStatus();
      console.log('[Demo] getProofStatus result:', result);
      if (result?.success && result.status) {
        setProofStatus(result.status);
      } else {
        console.warn('[Demo] getProofStatus failed:', result);
      }
    } catch (err) {
      console.error('[Demo] Failed to load proof status:', err);
    }
  }

  async function handleRequestAuth() {
    if (!window.midnightAuth) {
      setError('Extension not available');
      return;
    }

    if (!accountId.trim()) {
      setError('Please enter an account ID');
      return;
    }

    setState('requesting');
    setError(null);
    setResult(null);

    try {
      const authResult = await window.midnightAuth.requestAuth({
        accountId: accountId.trim(),
        challenge: challenge.trim() || undefined,
      });

      if (authResult.success) {
        setResult(authResult);
        setState('success');
      } else {
        setError(authResult.error || 'Authentication failed');
        setState('error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  }

  function formatProof(proof: number[]): string {
    const hex = proof.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 32)}...${hex.slice(-32)} (${proof.length} bytes)`;
  }

  function getProviderBadge(provider: string | null) {
    switch (provider) {
      case 'lace':
        return <span className="badge badge-lace">Lace</span>;
      case 'http':
        return <span className="badge badge-docker">Docker</span>;
      case 'mock':
        return <span className="badge badge-mock">Mock</span>;
      default:
        return <span className="badge badge-none">None</span>;
    }
  }

  if (state === 'checking') {
    return (
      <div className="container">
        <div className="card">
          <h1>Midnight Authenticator Demo</h1>
          <div className="loading">
            <div className="spinner" />
            <p>Checking for extension...</p>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="container">
        <div className="card">
          <h1>Midnight Authenticator Demo</h1>
          <div className="error-box">
            <h2>Extension Not Found</h2>
            <p>Please install the Midnight Authenticator extension to use this demo.</p>
            <ol>
              <li>Build the extension: <code>pnpm --filter @midnight-authenticator/extension build</code></li>
              <li>Open Chrome and go to <code>chrome://extensions</code></li>
              <li>Enable "Developer mode"</li>
              <li>Click "Load unpacked" and select <code>packages/extension/dist</code></li>
              <li>Refresh this page</li>
            </ol>
          </div>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <div className="header">
          <h1>Midnight Authenticator Demo</h1>
          {proofStatus && getProviderBadge(proofStatus.activeProvider)}
        </div>

        <p className="description">
          This demo shows how a dApp can request ZK authentication from the Midnight Authenticator extension.
          The extension generates a zero-knowledge proof that the user knows the correct secret without revealing it.
        </p>

        <div className="form">
          <div className="field">
            <label htmlFor="accountId">Account ID</label>
            <input
              id="accountId"
              type="text"
              placeholder="Enter account ID (hex string)"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={state === 'requesting'}
            />
            <small>You can find this in the extension's developer console</small>
          </div>

          <div className="field">
            <label htmlFor="challenge">Challenge (optional)</label>
            <input
              id="challenge"
              type="text"
              placeholder="Optional challenge string"
              value={challenge}
              onChange={(e) => setChallenge(e.target.value)}
              disabled={state === 'requesting'}
            />
          </div>

          <button
            onClick={handleRequestAuth}
            disabled={state === 'requesting'}
            className="primary"
          >
            {state === 'requesting' ? 'Requesting...' : 'Request Authentication'}
          </button>
        </div>

        {error && (
          <div className="error-box">
            <p>{error}</p>
          </div>
        )}

        {result && (
          <div className="result-box">
            <h2>Authentication Successful</h2>
            {result.isMock && (
              <div className="mock-warning">
                This is a mock proof (development mode)
              </div>
            )}
            <div className="result-details">
              <div className="detail">
                <span className="label">Provider:</span>
                <span className="value">{result.providerName || 'unknown'}</span>
              </div>
              {result.proof && (
                <div className="detail">
                  <span className="label">Proof:</span>
                  <span className="value mono">{formatProof(result.proof)}</span>
                </div>
              )}
              {result.publicInputs && (
                <>
                  <div className="detail">
                    <span className="label">Nonce:</span>
                    <span className="value mono">{result.publicInputs.nonce}</span>
                  </div>
                  <div className="detail">
                    <span className="label">Time Window:</span>
                    <span className="value mono">{result.publicInputs.expectedTimeWindow}</span>
                  </div>
                  <div className="detail">
                    <span className="label">Result:</span>
                    <span className="value">{result.publicInputs.result ? 'Valid' : 'Invalid'}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {proofStatus && (
          <div className="status-section">
            <h3>Proof Service Status</h3>
            <div className="status-grid">
              <div className="status-item">
                <span>Lace Wallet:</span>
                <span className={proofStatus.laceAvailable ? 'available' : 'unavailable'}>
                  {proofStatus.laceAvailable ? 'Available' : 'Not Found'}
                </span>
              </div>
              <div className="status-item">
                <span>Proof Server:</span>
                <span className={proofStatus.proofServerAvailable ? 'available' : 'unavailable'}>
                  {proofStatus.proofServerAvailable ? 'Running' : 'Not Running'}
                </span>
              </div>
              <div className="status-item">
                <span>Mock Mode:</span>
                <span className={proofStatus.mockEnabled ? 'enabled' : 'disabled'}>
                  {proofStatus.mockEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
