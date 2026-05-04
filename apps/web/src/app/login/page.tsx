'use client';

/**
 * @fileoverview Login page — username/password form with optional Slack OAuth.
 *
 * @module web/app/login
 */

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const err = searchParams.get('error');
    if (err === 'slack_denied') setError('Slack sign-in was cancelled.');
    else if (err) setError('Slack sign-in failed. Please try again.');
  }, [searchParams]);

  useEffect(() => {
    fetch('/api/auth/slack/status')
      .then(r => r.json())
      .then((d: { enabled: boolean }) => setSlackEnabled(d.enabled))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 360, background: 'var(--surface)', borderRadius: 14,
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)',
        padding: '36px 32px',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="SlackHive" style={{
            width: 44, height: 44, borderRadius: 12, margin: '0 auto 14px', display: 'block',
          }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
            SlackHive
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Sign in to continue
          </p>
        </div>

        {slackEnabled && (
          <div style={{ marginBottom: 20 }}>
            <a
              href="/api/auth/slack/authorize"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                width: '100%', padding: '10px', borderRadius: 8, boxSizing: 'border-box',
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontSize: 14, fontWeight: 600,
                textDecoration: 'none', cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <svg width="18" height="18" viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19.712 33.159a5.144 5.144 0 0 1-5.144 5.144 5.144 5.144 0 0 1-5.144-5.144 5.144 5.144 0 0 1 5.144-5.144h5.144v5.144z" fill="#E01E5A"/>
                <path d="M22.284 33.159a5.144 5.144 0 0 1 5.144-5.144 5.144 5.144 0 0 1 5.144 5.144v12.86a5.144 5.144 0 0 1-5.144 5.144 5.144 5.144 0 0 1-5.144-5.144v-12.86z" fill="#E01E5A"/>
                <path d="M27.428 19.712a5.144 5.144 0 0 1-5.144-5.144 5.144 5.144 0 0 1 5.144-5.144 5.144 5.144 0 0 1 5.144 5.144v5.144h-5.144z" fill="#36C5F0"/>
                <path d="M27.428 22.284a5.144 5.144 0 0 1 5.144 5.144 5.144 5.144 0 0 1-5.144 5.144H14.568a5.144 5.144 0 0 1-5.144-5.144 5.144 5.144 0 0 1 5.144-5.144h12.86z" fill="#36C5F0"/>
                <path d="M41.144 27.428a5.144 5.144 0 0 1 5.144 5.144 5.144 5.144 0 0 1-5.144 5.144 5.144 5.144 0 0 1-5.144-5.144v-5.144h5.144z" fill="#2EB67D"/>
                <path d="M38.572 27.428a5.144 5.144 0 0 1-5.144-5.144 5.144 5.144 0 0 1 5.144-5.144h12.86a5.144 5.144 0 0 1 5.144 5.144 5.144 5.144 0 0 1-5.144 5.144h-12.86z" fill="#2EB67D"/>
                <path d="M33.428 41.144a5.144 5.144 0 0 1-5.144 5.144 5.144 5.144 0 0 1-5.144-5.144 5.144 5.144 0 0 1 5.144-5.144h5.144v5.144z" fill="#ECB22E"/>
                <path d="M33.428 38.572a5.144 5.144 0 0 1 5.144-5.144 5.144 5.144 0 0 1 5.144 5.144v12.86a5.144 5.144 0 0 1-5.144 5.144 5.144 5.144 0 0 1-5.144-5.144v-12.86z" fill="#ECB22E"/>
              </svg>
              Sign in with Slack
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)',
                fontSize: 14, color: 'var(--text)', outline: 'none',
                fontFamily: 'var(--font-sans)',
                transition: 'border-color 0.15s',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)',
                fontSize: 14, color: 'var(--text)', outline: 'none',
                fontFamily: 'var(--font-sans)',
                transition: 'border-color 0.15s',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 13, color: '#dc2626', background: 'rgba(220,38,38,0.06)',
              padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.15)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              width: '100%', padding: '10px', borderRadius: 8, border: 'none',
              background: loading ? 'var(--border-2)' : 'var(--accent)',
              color: 'var(--accent-fg)', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-sans)',
              transition: 'opacity 0.15s',
              marginTop: 4,
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
