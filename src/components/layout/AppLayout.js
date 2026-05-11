// src/components/layout/AppLayout.js
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';

const navItems = [
  { path: '/',           icon: '⌂',  label: 'Today'      },
  { path: '/projects',   icon: '◈',  label: 'Projects'   },
  { path: '/brain-dump', icon: '◎',  label: 'Brain Dump' },
  { path: '/advisor',    icon: '✦',  label: 'Advisor'    },
  { path: '/review',     icon: '◷',  label: 'Review'     },
  { path: '/decisions',  icon: '⊡',  label: 'Decisions'  },
  { path: '/ideas',      icon: '◇',  label: 'Ideas'      },
  { path: '/debt',       icon: '◉',  label: 'Finance'    },
  { path: '/life',       icon: '▦',  label: 'Life OS'    },
];

function Sidebar({ collapsed, setCollapsed }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, profile, logout } = useAuth();
  const [showUser, setShowUser] = useState(false);

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div style={{
      width: collapsed ? 60 : 220,
      minHeight: '100vh',
      background: 'rgba(9,11,15,0.98)',
      borderRight: `1px solid ${tokens.border}`,
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      flexShrink: 0,
      zIndex: 50,
      backdropFilter: 'blur(20px)',
    }}>
      {/* Logo */}
      <div style={{ padding: collapsed ? '24px 0' : '24px 20px 20px', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
        <div
          onClick={() => setCollapsed(!collapsed)}
          style={{
            width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
            background: `linear-gradient(135deg, ${tokens.accent}, #9a7840)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '15px', cursor: 'pointer',
            boxShadow: `0 4px 16px rgba(200,169,110,0.25)`,
            marginLeft: collapsed ? 'auto' : 0,
            marginRight: collapsed ? 'auto' : 0,
          }}
        >
          ⚓
        </div>
        {!collapsed && (
          <div>
            <div style={{ fontFamily: fonts.display, fontSize: '16px', fontWeight: 700, color: tokens.textPrimary, letterSpacing: '-0.01em', lineHeight: 1 }}>Anchor</div>
            <div style={{ fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.12em', marginTop: '2px' }}>PERSONAL OS</div>
          </div>
        )}
      </div>

      {/* User chip */}
      {!collapsed && (
        <div style={{ padding: '0 12px 16px', borderBottom: `1px solid ${tokens.border}` }}>
          <div
            onClick={() => setShowUser(!showUser)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: '8px',
              background: tokens.bgCard, cursor: 'pointer',
              border: `1px solid ${tokens.border}`,
            }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: user?.photoURL ? 'transparent' : `linear-gradient(135deg, ${tokens.blue}, ${tokens.purple})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 700, overflow: 'hidden', flexShrink: 0,
            }}>
              {user?.photoURL
                ? <img src={user.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (user?.displayName?.[0] || 'A')}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile?.firstName || user?.displayName?.split(' ')[0] || 'Andrew'}
              </div>
              <div style={{ fontSize: '10px', color: tokens.textMuted }}>
                {profile?.energyToday ? `Energy: ${profile.energyToday}/10` : 'Set energy →'}
              </div>
            </div>
          </div>
          {showUser && (
            <div style={{ marginTop: 6, padding: '6px', background: tokens.bgCard, borderRadius: 8, border: `1px solid ${tokens.border}` }}>
              <button onClick={logout} style={{ width: '100%', background: 'none', border: 'none', color: tokens.red, fontSize: '12px', cursor: 'pointer', padding: '6px 8px', textAlign: 'left', borderRadius: 6 }}>
                Sign out
              </button>
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
        {navItems.map(item => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              title={collapsed ? item.label : ''}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: collapsed ? 0 : '10px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : '9px 12px',
                borderRadius: '8px',
                border: 'none',
                background: active ? tokens.accentDim : 'transparent',
                color: active ? tokens.accent : tokens.textSecondary,
                fontSize: '13px',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
                marginBottom: '2px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = tokens.bgCardHover; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '15px', flexShrink: 0, opacity: active ? 1 : 0.55 }}>{item.icon}</span>
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${tokens.border}` }}>
          <div style={{ fontSize: '11px', color: tokens.textMuted }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
        </div>
      )}
    </div>
  );
}

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = (path) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: 'rgba(9,11,15,0.97)',
      borderTop: `1px solid ${tokens.border}`,
      display: 'flex',
      padding: '6px 0 env(safe-area-inset-bottom, 8px)',
      backdropFilter: 'blur(20px)',
      zIndex: 100,
    }}>
      {navItems.slice(0, 6).map(item => {
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
              background: 'transparent', border: 'none',
              color: active ? tokens.accent : tokens.textMuted,
              cursor: 'pointer', padding: '6px 0',
              transition: 'color 0.15s',
            }}
          >
            <span style={{ fontSize: '17px' }}>{item.icon}</span>
            <span style={{ fontSize: '9px', letterSpacing: '0.03em', fontWeight: active ? 600 : 400 }}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function AppLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile]   = React.useState(window.innerWidth < 768);

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: tokens.bg }}>
      {!isMobile && <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />}

      <main style={{
        flex: 1,
        padding: isMobile ? '24px 16px 90px' : '36px 40px',
        overflowY: 'auto',
        minHeight: '100vh',
        maxWidth: isMobile ? '100%' : 'calc(100vw - ' + (collapsed ? '60px' : '220px') + ')',
      }}>
        {children}
      </main>

      {isMobile && <BottomNav />}
    </div>
  );
}
