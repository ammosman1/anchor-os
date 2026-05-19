// src/components/InstallPrompt.js
// Shows an "Install Anchor" banner when the app is installable as a PWA.
// Handles Chrome/Android (beforeinstallprompt) and surfaces manual instructions for iOS.
import React, { useState, useEffect } from 'react';
import { tokens, fonts } from '../lib/tokens';

const DISMISSED_KEY = 'anchorInstallDismissed';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow]                     = useState(false);
  const [isIOS, setIsIOS]                   = useState(false);
  const [iosInstructions, setIosInstructions] = useState(false);

  useEffect(() => {
    // Already installed (running in standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return; // iOS standalone

    // Previously dismissed
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (ios) {
      // iOS doesn't fire beforeinstallprompt — show manual instructions
      setIsIOS(true);
      setShow(true);
      return;
    }

    const handler = e => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setShow(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') setShow(false);
    else dismiss();
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
      left: '50%', transform: 'translateX(-50%)',
      width: 'calc(100% - 32px)', maxWidth: '480px',
      background: tokens.bgCard,
      border: `1px solid ${tokens.border}`,
      borderRadius: '12px',
      padding: '12px 14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      zIndex: 500,
      display: 'flex', flexDirection: 'column', gap: '10px',
    }}>
      {!iosInstructions ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '22px', flexShrink: 0 }}>⚓</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>Install Anchor</div>
              <div style={{ fontSize: '11px', color: tokens.textMuted, marginTop: '1px' }}>
                {isIOS ? 'Add to your home screen for quick access' : 'Install for offline access and a faster experience'}
              </div>
            </div>
            <button onClick={dismiss} style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '4px', fontFamily: fonts.body }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {isIOS ? (
              <button onClick={() => setIosInstructions(true)}
                style={{ flex: 1, background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.3)`, borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: tokens.accent, cursor: 'pointer', fontFamily: fonts.body }}>
                Show me how
              </button>
            ) : (
              <button onClick={install}
                style={{ flex: 1, background: tokens.accentDim, border: `1px solid rgba(200,169,110,0.3)`, borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: tokens.accent, cursor: 'pointer', fontFamily: fonts.body }}>
                Install App
              </button>
            )}
            <button onClick={dismiss}
              style={{ background: 'none', border: `1px solid ${tokens.border}`, borderRadius: '8px', padding: '8px 14px', fontSize: '12px', color: tokens.textMuted, cursor: 'pointer', fontFamily: fonts.body }}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary }}>Add to Home Screen</div>
            <button onClick={dismiss} style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '14px', fontFamily: fonts.body }}>✕</button>
          </div>
          <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[
              'Tap the Share button ↑ at the bottom of Safari',
              'Scroll down and tap "Add to Home Screen"',
              'Tap "Add" in the top-right corner',
            ].map((step, i) => (
              <li key={i} style={{ fontSize: '12px', color: tokens.textSecondary, lineHeight: 1.5 }}>{step}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
