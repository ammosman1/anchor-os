// src/components/layout/AppLayout.js
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { path: '/',         icon: '⌂', label: 'Today'    },
      { path: '/tasks',    icon: '✓', label: 'Tasks'    },
      { path: '/calendar', icon: '◫', label: 'Calendar' },
      { path: '/advisor',  icon: '✦', label: 'Advisor'  },
    ],
  },
  {
    label: 'Reflect',
    items: [
      { path: '/review', icon: '◷', label: 'Review'  },
      { path: '/goals',  icon: '◆', label: 'Goals'   },
      { path: '/life',   icon: '▦', label: 'Life OS' },
    ],
  },
  {
    label: 'Capture',
    items: [
      { path: '/projects',   icon: '◈', label: 'Projects'   },
      { path: '/brain-dump', icon: '◎', label: 'Brain Dump' },
    ],
  },
  {
    label: 'More',
    items: [
      { path: '/decisions', icon: '⊡', label: 'Decisions' },
      { path: '/ideas',     icon: '◇', label: 'Ideas'     },
      { path: '/debt',      icon: '◉', label: 'Finance'   },
    ],
  },
];

const PAGE_TITLES = {
  '/':           'Today',
  '/tasks':      'Tasks',
  '/calendar':   'Calendar',
  '/advisor':    'Advisor',
  '/review':     'Review',
  '/goals':      'Goals',
  '/life':       'Life OS',
  '/projects':   'Projects',
  '/brain-dump': 'Brain Dump',
  '/decisions':  'Decisions',
  '/ideas':      'Ideas',
  '/debt':       'Finance',
  '/profile':    'Settings',
};

function getPageTitle(pathname) {
  if (pathname === '/') return 'Today';
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== '/' && pathname.startsWith(path)) return title;
  }
  return 'Anchor';
}

export default function AppLayout({ children }) {
  const { user, logout }              = useAuth();
  const navigate                      = useNavigate();
  const location                      = useLocation();
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const photoURL    = user?.photoURL;
  const displayName = user?.displayName || user?.email || 'A';
  const initial     = (displayName[0] || 'A').toUpperCase();
  const pageTitle   = getPageTitle(location.pathname);

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const handleNav = (path) => {
    navigate(path);
    setDrawerOpen(false);
    setProfileOpen(false);
  };

  const navItemStyle = (active) => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: 'none',
    background: active ? tokens.accentDim : 'transparent',
    color: active ? tokens.accent : tokens.textSecondary,
    fontSize: '14px',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.12s, color 0.12s',
    fontFamily: fonts.body,
    marginBottom: '1px',
  });

  return (
    <div style={{ minHeight: '100vh', background: tokens.bg }}>

      {/* ── Top Bar ───────────────────────────────────────────────────────────── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 52,
        background: tokens.bgNav,
        borderBottom: `1px solid ${tokens.border}`,
        boxShadow: tokens.shadowNav,
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: '10px',
        zIndex: 200,
      }}>

        {/* Logo */}
        <div onClick={() => handleNav('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flexShrink: 0, userSelect: 'none' }}>
          <div style={{
            width: 30, height: 30, borderRadius: '9px',
            background: `linear-gradient(135deg, ${tokens.accent} 0%, #C8A050 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', boxShadow: `0 2px 8px rgba(154,120,48,0.25)`,
          }}>⚓</div>
          <span style={{ fontFamily: fonts.display, fontSize: '15px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.01em' }}>
            Anchor
          </span>
        </div>

        {/* Avatar */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            onClick={() => { setProfileOpen(o => !o); setDrawerOpen(false); }}
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: photoURL ? 'transparent' : `linear-gradient(135deg, ${tokens.blue}, ${tokens.purple})`,
              overflow: 'hidden', cursor: 'pointer',
              border: `2px solid ${profileOpen ? tokens.accent : tokens.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 700, color: '#fff',
              transition: 'border-color 0.15s',
            }}
            title="Profile & Settings"
          >
            {photoURL
              ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initial}
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Page title */}
        <span style={{
          fontSize: '13px', fontWeight: 600,
          color: tokens.textMuted,
          letterSpacing: '0.02em',
          userSelect: 'none',
        }}>
          {pageTitle}
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Hamburger */}
        <button
          onClick={() => { setDrawerOpen(o => !o); setProfileOpen(false); }}
          style={{
            background: drawerOpen ? tokens.accentDim : 'transparent',
            border: `1px solid ${drawerOpen ? tokens.borderFocus : tokens.border}`,
            borderRadius: '8px', padding: '5px 9px',
            cursor: 'pointer',
            color: drawerOpen ? tokens.accent : tokens.textSecondary,
            fontSize: '15px', lineHeight: 1,
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
          title="Menu"
          aria-label="Open navigation"
        >
          ☰
        </button>
      </header>

      {/* ── Profile Dropdown ──────────────────────────────────────────────────── */}
      {profileOpen && (
        <>
          <div onClick={() => setProfileOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 198 }} />
          <div className="fade-up" style={{
            position: 'fixed', top: '58px', left: '16px',
            width: 230,
            background: tokens.bgCard,
            border: `1px solid ${tokens.border}`,
            borderRadius: '14px',
            padding: '8px',
            zIndex: 199,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          }}>
            {/* User info header */}
            <div style={{
              display: 'flex', gap: '10px', alignItems: 'center',
              padding: '10px 10px 12px',
              borderBottom: `1px solid ${tokens.border}`,
              marginBottom: '6px',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: photoURL ? 'transparent' : `linear-gradient(135deg, ${tokens.blue}, ${tokens.purple})`,
                overflow: 'hidden', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '15px', fontWeight: 700,
                color: '#fff', flexShrink: 0,
              }}>
                {photoURL
                  ? <img src={photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : initial}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.displayName || 'User'}
                </div>
                <div style={{ fontSize: '11px', color: tokens.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                  {user?.email}
                </div>
              </div>
            </div>

            {/* Settings link */}
            <button onClick={() => handleNav('/profile')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 10px', borderRadius: '8px', background: 'none', border: 'none', color: tokens.textSecondary, fontSize: '13px', cursor: 'pointer', textAlign: 'left', fontFamily: fonts.body, transition: 'all 0.12s' }}
              onMouseEnter={e => { e.currentTarget.style.background = tokens.bgCardHover; e.currentTarget.style.color = tokens.textPrimary; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = tokens.textSecondary; }}
            >
              <span style={{ opacity: 0.6 }}>⚙</span> Profile & Settings
            </button>

            {/* Sign out */}
            <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: '4px', paddingTop: '4px' }}>
              <button onClick={() => { logout(); setProfileOpen(false); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 10px', borderRadius: '8px', background: 'none', border: 'none', color: tokens.red, fontSize: '13px', cursor: 'pointer', textAlign: 'left', fontFamily: fonts.body, transition: 'background 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.background = tokens.redDim}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <span style={{ opacity: 0.7 }}>↪</span> Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Nav Drawer ────────────────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div onClick={() => setDrawerOpen(false)} style={{
            position: 'fixed', inset: 0,
            background: 'rgba(28,24,20,0.25)',
            backdropFilter: 'blur(2px)',
            zIndex: 298,
          }} />

          {/* Drawer panel */}
          <div className="slide-in-right" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: Math.min(300, window.innerWidth * 0.85),
            background: tokens.bgCard,
            borderLeft: `1px solid ${tokens.border}`,
            boxShadow: '-8px 0 32px rgba(0,0,0,0.10)',
            zIndex: 299,
            display: 'flex', flexDirection: 'column',
            overflowY: 'auto',
          }}>
            {/* Drawer header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px',
              borderBottom: `1px solid ${tokens.border}`,
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: 28, height: 28, borderRadius: '8px', background: `linear-gradient(135deg, ${tokens.accent}, #C8A050)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>⚓</div>
                <span style={{ fontFamily: fonts.display, fontSize: '15px', fontWeight: 700, color: tokens.textPrimary }}>Anchor</span>
              </div>
              <button onClick={() => setDrawerOpen(false)}
                style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '18px', cursor: 'pointer', padding: '4px', lineHeight: 1, borderRadius: '6px' }}
                onMouseEnter={e => e.currentTarget.style.background = tokens.bgCardHover}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >✕</button>
            </div>

            {/* Nav groups */}
            <nav style={{ flex: 1, padding: '8px 10px', overflowY: 'auto' }}>
              {NAV_GROUPS.map((group, gi) => (
                <div key={gi} style={{ marginBottom: '6px' }}>
                  <div style={{
                    fontSize: '10px', fontWeight: 700, color: tokens.textMuted,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    padding: '8px 10px 4px',
                  }}>
                    {group.label}
                  </div>
                  {group.items.map(item => {
                    const active = isActive(item.path);
                    return (
                      <button key={item.path} onClick={() => handleNav(item.path)}
                        style={navItemStyle(active)}
                        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = tokens.bgCardHover; e.currentTarget.style.color = tokens.textPrimary; } }}
                        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = tokens.textSecondary; } }}
                      >
                        <span style={{ fontSize: '16px', width: '20px', textAlign: 'center', flexShrink: 0, opacity: active ? 1 : 0.5 }}>
                          {item.icon}
                        </span>
                        {item.label}
                        {active && (
                          <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: tokens.accent, flexShrink: 0 }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            {/* Drawer footer */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${tokens.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: '11px', color: tokens.textMuted }}>
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Main Content ──────────────────────────────────────────────────────── */}
      <main style={{
        paddingTop: '76px',   // 52px topbar + 24px breathing room
        paddingLeft: 'max(16px, env(safe-area-inset-left, 16px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 16px))',
        paddingBottom: 'max(40px, env(safe-area-inset-bottom, 40px))',
        minHeight: '100vh',
        maxWidth: '960px',
        margin: '0 auto',
      }}>
        {children}
      </main>
    </div>
  );
}
