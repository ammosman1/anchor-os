// src/components/layout/AppLayout.js
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';
import { useAuth } from '../../context/AuthContext';

const navItems = [
  { path: '/',           icon: '⌂',  label: 'Today'      },
  { path: '/tasks',      icon: '✓',  label: 'Tasks'      },
  { path: '/projects',   icon: '◈',  label: 'Projects'   },
  { path: '/brain-dump', icon: '◎',  label: 'Brain Dump' },
  { path: '/advisor',    icon: '✦',  label: 'Advisor'    },
  { path: '/goals',      icon: '◆',  label: 'Goals'      },
  { path: '/review',     icon: '◷',  label: 'Review'     },
  { path: '/decisions',  icon: '⊡',  label: 'Decisions'  },
  { path: '/ideas',      icon: '◇',  label: 'Ideas'      },
  { path: '/debt',       icon: '◉',  label: 'Finance'    },
  { path: '/life',       icon: '▦',  label: 'Life OS'    },
  { path: '/profile',   icon: '⚙',  label: 'Settings'   },
];

const bottomNavItems = navItems.slice(0, 5);
const moreNavItems   = navItems.slice(5);

function Sidebar({ collapsed, setCollapsed }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, logout } = useAuth();
  const [showUser, setShowUser] = useState(false);
  const isActive = (path) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div style={{
      width: collapsed ? 60 : 220,
      minHeight: '100vh',
      background: 'rgba(9,11,15,0.98)',
      borderRight: `1px solid ${tokens.border}`,
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      flexShrink: 0, zIndex: 50,
      backdropFilter: 'blur(20px)',
      position: 'relative',
    }}>
      {/* Logo row */}
      <div style={{ padding: collapsed ? '20px 0 16px' : '20px 16px 16px', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', borderBottom: `1px solid ${tokens.border}` }}>
        <div style={{
          width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
          background: `linear-gradient(135deg, ${tokens.accent}, #9a7840)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '15px', boxShadow: `0 4px 16px rgba(200,169,110,0.25)`,
          marginLeft: collapsed ? 'auto' : 0, marginRight: collapsed ? 'auto' : 0,
        }}>⚓</div>
        {!collapsed && (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: fonts.display, fontSize: '15px', fontWeight: 700, color: tokens.textPrimary, lineHeight: 1 }}>Anchor</div>
              <div style={{ fontSize: '9px', color: tokens.textMuted, letterSpacing: '0.12em', marginTop: '2px' }}>PERSONAL OS</div>
            </div>
            <button onClick={() => setCollapsed(true)} style={{ background: 'none', border: 'none', color: tokens.textMuted, cursor: 'pointer', fontSize: '16px', padding: '4px', lineHeight: 1 }} title="Collapse">←</button>
          </>
        )}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <button onClick={() => setCollapsed(false)} style={{ margin: '10px auto 0', background: tokens.bgCard, border: `1px solid ${tokens.border}`, color: tokens.textMuted, cursor: 'pointer', fontSize: '12px', padding: '5px 8px', borderRadius: '6px', display: 'block', fontFamily: fonts.body }}>→</button>
      )}

      {/* User chip */}
      {!collapsed && (
        <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${tokens.border}` }}>
          <div onClick={() => setShowUser(!showUser)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px', background: tokens.bgCard, cursor: 'pointer', border: `1px solid ${tokens.border}` }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: user?.photoURL ? 'transparent' : `linear-gradient(135deg, ${tokens.blue}, ${tokens.purple})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, overflow: 'hidden', flexShrink: 0 }}>
              {user?.photoURL ? <img src={user.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (user?.displayName?.[0] || 'A')}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: tokens.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.firstName || user?.displayName?.split(' ')[0] || 'Andrew'}</div>
              <div style={{ fontSize: '10px', color: tokens.textMuted }}>{profile?.energyToday ? `Energy: ${profile.energyToday}/10` : 'Set energy →'}</div>
            </div>
          </div>
          {showUser && (
            <div style={{ marginTop: 6, padding: '4px', background: tokens.bgCard, borderRadius: 8, border: `1px solid ${tokens.border}` }}>
              <button onClick={logout} style={{ width: '100%', background: 'none', border: 'none', color: tokens.red, fontSize: '12px', cursor: 'pointer', padding: '6px 8px', textAlign: 'left', borderRadius: 6, fontFamily: fonts.body }}>Sign out</button>
            </div>
          )}
        </div>
      )}

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {navItems.map(item => {
          const active = isActive(item.path);
          return (
            <button key={item.path} onClick={() => navigate(item.path)} title={collapsed ? item.label : ''}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: collapsed ? 0 : '10px', justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '10px 0' : '9px 12px', borderRadius: '8px', border: 'none', background: active ? tokens.accentDim : 'transparent', color: active ? tokens.accent : tokens.textSecondary, fontSize: '13px', fontWeight: active ? 600 : 400, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s ease', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', fontFamily: fonts.body }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = tokens.bgCardHover; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '15px', flexShrink: 0, opacity: active ? 1 : 0.55 }}>{item.icon}</span>
              {!collapsed && item.label}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${tokens.border}` }}>
          <div style={{ fontSize: '11px', color: tokens.textMuted }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
      )}
    </div>
  );
}

function BottomNav() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const [showMore, setShowMore] = useState(false);
  const isActive = (path) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const handleNav = (path) => { navigate(path); setShowMore(false); };

  return (
    <>
      {showMore && <div onClick={() => setShowMore(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 98 }} />}

      {showMore && (
        <div className="fade-up" style={{ position: 'fixed', bottom: 'calc(62px + env(safe-area-inset-bottom, 0px))', left: '12px', right: '12px', background: '#141720', border: `1px solid ${tokens.border}`, borderRadius: '16px', padding: '8px', zIndex: 99, boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: '10px', color: tokens.textMuted, fontWeight: 700, letterSpacing: '0.1em', padding: '6px 12px 8px', textTransform: 'uppercase' }}>More</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            {moreNavItems.map(item => {
              const active = isActive(item.path);
              return (
                <button key={item.path} onClick={() => handleNav(item.path)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '10px', background: active ? tokens.accentDim : 'transparent', border: `1px solid ${active ? 'rgba(200,169,110,0.2)' : 'transparent'}`, color: active ? tokens.accent : tokens.textSecondary, fontSize: '14px', fontWeight: active ? 600 : 400, cursor: 'pointer', textAlign: 'left', fontFamily: fonts.body }}>
                  <span style={{ fontSize: '18px' }}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(9,11,15,0.97)', borderTop: `1px solid ${tokens.border}`, display: 'flex', paddingBottom: '0px', paddingTop: '6px', backdropFilter: 'blur(20px)', zIndex: 100 }}>
        {bottomNavItems.map(item => {
          const active = isActive(item.path);
          return (
            <button key={item.path} onClick={() => { setShowMore(false); navigate(item.path); }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', background: 'transparent', border: 'none', color: active ? tokens.accent : tokens.textMuted, cursor: 'pointer', padding: '4px 0', transition: 'color 0.15s', fontFamily: fonts.body }}>
              <span style={{ fontSize: '17px' }}>{item.icon}</span>
              <span style={{ fontSize: '9px', letterSpacing: '0.03em', fontWeight: active ? 600 : 400 }}>{item.label}</span>
            </button>
          );
        })}
        <button onClick={() => setShowMore(!showMore)}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', background: 'transparent', border: 'none', color: showMore ? tokens.accent : tokens.textMuted, cursor: 'pointer', padding: '4px 0', fontFamily: fonts.body }}>
          <span style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '0.1em' }}>···</span>
          <span style={{ fontSize: '9px', letterSpacing: '0.03em' }}>More</span>
        </button>
      </div>
    </>
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
      <main style={{ flex: 1, paddingTop: isMobile ? 'max(24px, env(safe-area-inset-top, 24px))' : '32px', paddingLeft: isMobile ? '16px' : '36px', paddingRight: isMobile ? '16px' : '36px', paddingBottom: isMobile ? 'calc(75px + env(safe-area-inset-bottom, 0px))' : '40px', overflowY: 'auto', minHeight: '100vh' }}>
        {children}
      </main>
      {isMobile && <BottomNav />}
    </div>
  );
}