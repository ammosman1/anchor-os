// src/components/ui/index.js
import React, { useState } from 'react';
import { tokens, fonts } from '../../lib/tokens';

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style = {}, onClick, glass = false, accent = false }) {
  const [hovered, setHovered] = useState(false);
  const isClickable = !!onClick;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => isClickable && setHovered(true)}
      onMouseLeave={() => isClickable && setHovered(false)}
      style={{
        background: accent
          ? `linear-gradient(135deg, ${tokens.accentDim} 0%, ${tokens.accentGlow} 100%)`
          : glass ? tokens.bgGlass : (hovered ? tokens.bgCardHover : tokens.bgCard),
        border: `1px solid ${accent ? tokens.accentDim : hovered ? tokens.borderHover : tokens.border}`,
        borderRadius: tokens.radiusLg,
        padding: '20px',
        transition: 'all 0.18s ease',
        cursor: isClickable ? 'pointer' : 'default',
        boxShadow: tokens.shadowCard,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────
export function Button({
  children, onClick, disabled = false, variant = 'primary',
  size = 'md', style = {}, loading = false,
}) {
  const [hovered, setHovered] = useState(false);

  const variants = {
    primary: {
      background: disabled ? tokens.track : hovered ? tokens.accentLight : tokens.accent,
      color: disabled ? tokens.textDisabled : tokens.bgCard === '#FFFFFF' ? '#0C0E12' : '#fff',
      border: 'none',
    },
    ghost: {
      background: hovered ? tokens.bgCardHover : 'transparent',
      color: hovered ? tokens.textPrimary : tokens.textSecondary,
      border: `1px solid ${hovered ? tokens.borderHover : tokens.border}`,
    },
    danger: {
      background: hovered ? tokens.redDim : 'transparent',
      color: tokens.red,
      border: `1px solid ${tokens.redDim}`,
    },
    accent: {
      background: hovered ? tokens.accentDim : `${tokens.accentDim}88`,
      color: tokens.accent,
      border: `1px solid ${tokens.accentDim}`,
    },
  };

  const sizes = {
    sm: { padding: '5px 12px', fontSize: '11px' },
    md: { padding: '9px 18px', fontSize: '13px' },
    lg: { padding: '13px 24px', fontSize: '14px' },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...variants[variant],
        ...sizes[size],
        borderRadius: tokens.radiusMd,
        fontWeight: 600,
        letterSpacing: '0.02em',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {loading && <span className="spinning" style={{ fontSize: '12px' }}>⟳</span>}
      {children}
    </button>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Input({ label, value, onChange, placeholder, type = 'text', style = {}, multiline = false, rows = 4 }) {
  const [focused, setFocused] = useState(false);
  const inputStyle = {
    width: '100%',
    background: tokens.bgInput,
    border: `1px solid ${focused ? tokens.borderFocus : tokens.border}`,
    borderRadius: tokens.radiusMd,
    padding: '10px 14px',
    color: tokens.textPrimary,
    fontSize: '13px',
    lineHeight: 1.6,
    outline: 'none',
    transition: 'border-color 0.15s ease',
    resize: multiline ? 'vertical' : 'none',
    fontFamily: fonts.body,
    ...style,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted }}>{label}</label>}
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={inputStyle}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={inputStyle}
        />
      )}
    </div>
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function Select({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && <label style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.textMuted }}>{label}</label>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: tokens.bgInput,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radiusMd,
          padding: '10px 14px',
          color: tokens.textPrimary,
          fontSize: '13px',
          outline: 'none',
          cursor: 'pointer',
          fontFamily: fonts.body,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Tag ──────────────────────────────────────────────────────────────────────
export function Tag({ label, color = tokens.accentDim, textColor = tokens.accent, size = 'sm' }) {
  const sizes = { sm: '10px', md: '11px' };
  return (
    <span style={{
      fontSize: sizes[size],
      fontWeight: 700,
      letterSpacing: '0.07em',
      textTransform: 'uppercase',
      padding: size === 'sm' ? '2px 8px' : '3px 10px',
      borderRadius: '4px',
      background: color,
      color: textColor,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ─── MomentumBar ──────────────────────────────────────────────────────────────
export function MomentumBar({ value = 0, color = tokens.accent, height = 3 }) {
  return (
    <div style={{ height, background: tokens.track, borderRadius: 99, overflow: 'hidden', width: '100%' }}>
      <div style={{
        height: '100%',
        width: `${Math.min(100, Math.max(0, value))}%`,
        background: color,
        borderRadius: 99,
        transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
      }} />
    </div>
  );
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────
export function SectionLabel({ children, style = {} }) {
  return (
    <div style={{
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: tokens.textMuted,
      marginBottom: '14px',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 20, color = tokens.accent }) {
  return (
    <div className="spinning" style={{
      width: size, height: size,
      border: `2px solid ${tokens.track}`,
      borderTop: `2px solid ${color}`,
      borderRadius: '50%',
    }} />
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 480 }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-up"
        style={{
          background: tokens.bgCard,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radiusXl,
          padding: '28px',
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontFamily: fonts.display, fontSize: '18px', fontWeight: 700, color: tokens.textPrimary }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: tokens.textMuted, fontSize: '18px', cursor: 'pointer', padding: '4px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── AICard ───────────────────────────────────────────────────────────────────

function renderAIText(text) {
  if (!text) return null;
  const lines = text.split('\n').filter(l => l.trim());
  const elements = [];
  let bulletGroup = [];

  const flushBullets = () => {
    if (!bulletGroup.length) return;
    elements.push(
      <div key={`b-${elements.length}`} style={{ display: 'flex', flexDirection: 'column', gap: '5px', margin: '4px 0' }}>
        {bulletGroup.map((content, bi) => (
          <div key={bi} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ color: tokens.accent, flexShrink: 0, fontSize: '8px', marginTop: '5px', lineHeight: 1 }}>◆</span>
            <span style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
            />
          </div>
        ))}
      </div>
    );
    bulletGroup = [];
  };

  lines.forEach((line, i) => {
    const t = line.trim();
    const isBullet = /^[-•*]\s/.test(t);
    const isNumbered = /^\d+\.\s/.test(t);
    const isHeader = t.endsWith(':') && t.length < 70 && !/[.!?]/.test(t.slice(0, -1));

    if (isBullet) {
      bulletGroup.push(t.slice(2));
    } else if (isNumbered) {
      bulletGroup.push(t.replace(/^\d+\.\s/, ''));
    } else {
      flushBullets();
      if (isHeader) {
        elements.push(
          <div key={i} style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: elements.length ? '10px' : 0, marginBottom: '2px' }}>
            {t.slice(0, -1)}
          </div>
        );
      } else if (t) {
        elements.push(
          <p key={i} style={{ fontSize: '13px', color: tokens.textPrimary, lineHeight: 1.65, margin: '0 0 5px' }}
            dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
          />
        );
      }
    }
  });
  flushBullets();
  return <div>{elements}</div>;
}

export function AICard({ text, loading, onRefresh, label = 'ANCHOR', feedbackButtons }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${tokens.accentGlow} 0%, transparent 100%)`,
      border: `1px solid ${tokens.accentDim}`,
      borderRadius: tokens.radiusLg,
      padding: '18px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: `radial-gradient(circle, ${tokens.accentGlow} 0%, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <div style={{ width: 30, height: 30, borderRadius: '8px', background: tokens.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: 0 }}>✦</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: tokens.accent, letterSpacing: '0.1em', marginBottom: '8px' }}>{label}</div>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Spinner size={14} />
              <span style={{ fontSize: '13px', color: tokens.textMuted }}>Thinking...</span>
            </div>
          ) : (
            renderAIText(text)
          )}
        </div>
      </div>
      {(!loading) && (onRefresh || feedbackButtons) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
          <div>{feedbackButtons}</div>
          {onRefresh && (
            <button onClick={onRefresh} style={{ fontSize: '11px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
              ↻ Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}>{icon}</div>
      <div style={{ fontFamily: fonts.display, fontSize: '16px', color: tokens.textSecondary, marginBottom: '6px' }}>{title}</div>
      {subtitle && <div style={{ fontSize: '13px', color: tokens.textMuted, marginBottom: '16px' }}>{subtitle}</div>}
      {action}
    </div>
  );
}

// ─── Dot ──────────────────────────────────────────────────────────────────────
export function Dot({ color, size = 7 }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0 }} />;
}

// ─── StatusTag helpers ─────────────────────────────────────────────────────────
// Derived from tokens so they work across all themes
export const statusColors = {
  active:   { bg: tokens.greenDim,  text: tokens.green  },
  stalled:  { bg: tokens.redDim,    text: tokens.red    },
  planning: { bg: tokens.blueDim,   text: tokens.blue   },
  complete: { bg: tokens.purpleDim, text: tokens.purple },
  paused:   { bg: tokens.track,     text: tokens.textMuted },
};

export const priorityColors = {
  critical: { bg: tokens.redDim,    text: tokens.red    },
  high:     { bg: tokens.accentDim, text: tokens.accent },
  medium:   { bg: tokens.blueDim,   text: tokens.blue   },
  low:      { bg: tokens.track,     text: tokens.textMuted },
};
