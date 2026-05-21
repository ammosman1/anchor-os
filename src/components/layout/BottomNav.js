// src/components/layout/BottomNav.js
// Persistent bottom navigation bar — Today | Tasks | ✦ (advisor) | Calendar | Goals
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { tokens, fonts } from '../../lib/tokens';

const ADVISOR_GLOW_CSS = `
  @keyframes advisorPulse {
    0%, 100% {
      box-shadow: 0 4px 14px rgba(154,120,48,0.5), 0 0 0 0 rgba(200,165,60,0);
    }
    50% {
      box-shadow: 0 6px 22px rgba(154,120,48,0.75), 0 0 18px 5px rgba(200,165,60,0.22);
    }
  }
  @keyframes advisorRingPulse {
    0%, 100% { opacity: 0; transform: translateX(-50%) scale(1); }
    40%       { opacity: 0.35; transform: translateX(-50%) scale(1.28); }
    70%       { opacity: 0; transform: translateX(-50%) scale(1.5); }
  }
`;

const NAV_ITEMS = [
  { path: '/',         icon: '⌂', label: 'Today'    },
  { path: '/tasks',    icon: '✓', label: 'Tasks'    },
  null,                                                // center advisor slot
  { path: '/calendar', icon: '◫', label: 'Calendar' },
  { path: '/goals',    icon: '◆', label: 'Goals'    },
];

export const BOTTOM_NAV_HEIGHT = 56; // px (excluding safe-area-inset-bottom)

export default function BottomNav({ advisorOpen, onAdvisorToggle }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <>
    <style>{ADVISOR_GLOW_CSS}</style>
    <nav style={{
      position:      'fixed',
      bottom:        0,
      left:          0,
      right:         0,
      height:        `${BOTTOM_NAV_HEIGHT}px`,
      paddingBottom: 0,
      background:    tokens.bgNav,
      borderTop:     `1px solid ${tokens.border}`,
      boxShadow:     '0 -2px 16px rgba(0,0,0,0.10)',
      display:       'flex',
      alignItems:    'stretch',
      zIndex:        192,
    }}>
      {NAV_ITEMS.map((item, i) => {
        // ── Center advisor button ──────────────────────────────────────
        if (item === null) {
          return (
            <div key="advisor" style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}>
              {/* Expanding ring behind button */}
              {!advisorOpen && (
                <div style={{
                  position:     'absolute',
                  bottom:       10,
                  left:         '50%',
                  transform:    'translateX(-50%)',
                  width:        50,
                  height:       50,
                  borderRadius: '50%',
                  border:       `2px solid rgba(200,165,60,0.5)`,
                  pointerEvents: 'none',
                  animation:    'advisorRingPulse 2.8s ease-in-out infinite',
                  zIndex:       192,
                }} />
              )}
              <button
                onClick={onAdvisorToggle}
                title="AI Advisor"
                style={{
                  position:     'absolute',
                  bottom:       10,
                  left:         '50%',
                  transform:    'translateX(-50%)',
                  width:        50,
                  height:       50,
                  borderRadius: '50%',
                  background:   advisorOpen
                    ? 'linear-gradient(135deg, #8B6E3A 0%, #A08040 100%)'
                    : `linear-gradient(135deg, ${tokens.accent} 0%, #C8A050 50%, #E8C070 100%)`,
                  border:       advisorOpen ? 'none' : `1.5px solid rgba(240,200,100,0.4)`,
                  boxShadow:    advisorOpen
                    ? `0 4px 14px rgba(154,120,48,0.3)`
                    : undefined,
                  animation:    advisorOpen ? 'none' : 'advisorPulse 2.8s ease-in-out infinite',
                  cursor:       'pointer',
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent: 'center',
                  fontSize:     advisorOpen ? '16px' : '19px',
                  color:        '#0C0E12',
                  lineHeight:   1,
                  transition:   'transform 0.18s, background 0.18s',
                  zIndex:       193,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateX(-50%) scale(1.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
                }}
              >
                {advisorOpen ? '✕' : '✦'}
              </button>
            </div>
          );
        }

        // ── Regular nav item ───────────────────────────────────────────
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            style={{
              flex:           1,
              position:       'relative',
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            '3px',
              background:     'transparent',
              border:         'none',
              cursor:         'pointer',
              color:          active ? tokens.accent : tokens.textMuted,
              transition:     'color 0.15s',
              padding:        '8px 2px 6px',
              fontFamily:     fonts.body,
              WebkitTapHighlightColor: 'transparent',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = tokens.textSecondary; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = tokens.textMuted; }}
          >
            <span style={{
              fontSize:   '17px',
              lineHeight: 1,
              opacity:    active ? 1 : 0.55,
              transition: 'opacity 0.15s',
            }}>
              {item.icon}
            </span>
            <span style={{
              fontSize:      '9px',
              fontWeight:    active ? 700 : 400,
              letterSpacing: '0.03em',
              lineHeight:    1,
            }}>
              {item.label}
            </span>
            {/* Active indicator bar */}
            {active && (
              <div style={{
                position:     'absolute',
                bottom:       0,
                left:         '50%',
                transform:    'translateX(-50%)',
                width:        24,
                height:       2,
                borderRadius: '2px 2px 0 0',
                background:   tokens.accent,
              }} />
            )}
          </button>
        );
      })}
    </nav>
    </>
  );
}
