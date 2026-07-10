import { useEffect, useState } from 'react';
import {
  checkHealth,
  deleteKey,
  forgotPassword,
  listKeys,
  login,
  logout,
  registerAccount,
  resetPassword,
  serverUrl,
  setKey,
  setServerUrl,
  useServer,
  type ApiKeyInfo,
} from '../server/api.js';

const PROVIDERS = ['openai', 'stability', 'runware', 'fal', 'anthropic'];

type AuthTab = 'login' | 'register' | 'forgot' | 'reset';

function AuthForms() {
  const [tab, setTab] = useState<AuthTab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (tab === 'login') await login(email, password);
      else if (tab === 'register') await registerAccount(email, password);
      else if (tab === 'forgot') {
        await forgotPassword(email);
        setNotice('If that email exists, a reset mail was sent. Paste the token under "Reset".');
        setTab('reset');
      } else {
        await resetPassword(token, password);
        setNotice('Password changed — sign in with the new password.');
        setTab('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const TABS: { id: AuthTab; label: string }[] = [
    { id: 'login', label: 'Sign in' },
    { id: 'register', label: 'Register' },
    { id: 'forgot', label: 'Forgot' },
    { id: 'reset', label: 'Reset' },
  ];

  return (
    <div className="server-auth">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => {
              setTab(t.id);
              setError('');
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {tab !== 'reset' && (
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        {tab === 'reset' && (
          <input
            required
            placeholder="reset token (from the email)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        )}
        {tab !== 'forgot' && (
          <input
            type="password"
            required
            minLength={8}
            placeholder={tab === 'reset' ? 'new password (min 8 chars)' : 'password (min 8 chars)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <button type="submit" disabled={busy}>
          {tab === 'login'
            ? 'Sign in'
            : tab === 'register'
              ? 'Create account'
              : tab === 'forgot'
                ? 'Send reset mail'
                : 'Set new password'}
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-notice">{notice}</div>}
    </div>
  );
}

function KeysSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const reload = () =>
    listKeys()
      .then(setKeys)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    void reload();
  }, []);

  async function save(provider: string) {
    const draft = drafts[provider]?.trim();
    if (!draft) return;
    try {
      await setKey(provider, draft);
      setDrafts((d) => ({ ...d, [provider]: '' }));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="server-keys">
      <div className="panel-title">AI provider API keys (stored encrypted on the server)</div>
      {PROVIDERS.map((provider) => {
        const existing = keys.find((k) => k.provider === provider);
        return (
          <div key={provider} className="key-row">
            <span className="key-provider">{provider}</span>
            <span className="key-masked">{existing ? `••••${existing.last4}` : 'not set'}</span>
            <input
              type="password"
              placeholder="paste key"
              value={drafts[provider] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [provider]: e.target.value }))}
            />
            <button disabled={!drafts[provider]?.trim()} onClick={() => void save(provider)}>
              Save
            </button>
            {existing && (
              <button title="Remove key" onClick={() => void deleteKey(provider).then(reload)}>
                ✕
              </button>
            )}
          </div>
        );
      })}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

export function ServerModal({ onClose }: { onClose: () => void }) {
  const user = useServer((s) => s.user);
  const [url, setUrl] = useState(serverUrl());
  const [health, setHealth] = useState<'unknown' | 'ok' | 'down'>('unknown');

  async function testConnection() {
    setServerUrl(url);
    setHealth((await checkHealth()) ? 'ok' : 'down');
  }

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-panel server-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">Server</div>
        <div className="server-url-row">
          <input
            value={url}
            placeholder="http://localhost:8100"
            onChange={(e) => setUrl(e.target.value)}
          />
          <button onClick={() => void testConnection()}>Test</button>
          {health !== 'unknown' && (
            <span className={`health ${health}`}>{health === 'ok' ? 'connected' : 'offline'}</span>
          )}
        </div>
        {!user && <AuthForms />}
        {user && (
          <>
            <div className="server-user-row">
              Signed in as <strong>{user.email}</strong>
              <button onClick={() => void logout()}>Log out</button>
            </div>
            <KeysSection />
          </>
        )}
        <button className="close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
