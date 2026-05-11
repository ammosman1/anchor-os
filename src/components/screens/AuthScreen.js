// src/components/screens/AuthScreen.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';

export default function AuthScreen() {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      setError('Sign in failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: tokens.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background texture */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 60% 50% at 20% 20%, rgba(200,169,110,0.05) 0%, transparent 60%),
          radial-gradient(ellipse 40% 60% at 80% 80%, rgba(91,143,212,0.04) 0%, transparent 60%)
        `,
      }} />

      <div className="fade-up" style={{ width: '100%', maxWidth: 420, textAlign: 'center', position: 'relative' }}>
        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '18px',
            background: `linear-gradient(135deg, ${tokens.accent} 0%, #9a7840 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px',
            boxShadow: `0 8px 32px rgba(200,169,110,0.3), 0 0 0 1px rgba(200,169,110,0.15)`,
          }}>
            ⚓
          </div>
        </div>

        <h1 style={{
          fontFamily: fonts.display,
          fontSize: '36px',
          fontWeight: 700,
          color: tokens.textPrimary,
          letterSpacing: '-0.02em',
          marginBottom: '8px',
        }}>
          Anchor
        </h1>

        <p style={{
          fontSize: '14px',
          color: tokens.textSecondary,
          marginBottom: '48px',
          lineHeight: 1.6,
        }}>
          Your personal operating system.<br />Clarity, momentum, and strategic focus.
        </p>

        {/* Sign in card */}
        <div style={{
          background: tokens.bgCard,
          border: `1px solid ${tokens.border}`,
          borderRadius: '16px',
          padding: '32px',
          boxShadow: tokens.shadowCard,
        }}>
          <p style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '20px' }}>
            Sign in to access your OS
          </p>

          <button
            onClick={handleSignIn}
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              padding: '13px 20px',
              background: loading ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${tokens.border}`,
              borderRadius: '10px',
              color: loading ? tokens.textMuted : tokens.textPrimary,
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: fonts.body,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          >
            {loading ? (
              <span className="spinning" style={{ fontSize: '16px' }}>⟳</span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            {loading ? 'Signing in...' : 'Continue with Google'}
          </button>

          {error && (
            <p style={{ marginTop: '12px', fontSize: '12px', color: tokens.red, textAlign: 'center' }}>{error}</p>
          )}

          <div style={{ marginTop: '20px', padding: '12px', background: tokens.accentGlow, borderRadius: '8px', border: `1px solid rgba(200,169,110,0.1)` }}>
            <p style={{ fontSize: '11px', color: tokens.textMuted, lineHeight: 1.6 }}>
              Your data is private and stored securely in your personal Firebase account. Nothing is shared.
            </p>
          </div>
        </div>

        <p style={{ marginTop: '24px', fontSize: '11px', color: tokens.textMuted }}>
          Built for clarity. Not for the masses.
        </p>
      </div>
    </div>
  );
}
