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
          ? 'linear-gradient(135deg, rgba(200,169,110,0.09) 0%, rgba(200,169,110,0.03) 100%)'
          : glass ? tokens.bgGlass : (hovered ? tokens.bgCardHover : tokens.bgCard),
        border: `1px solid ${accent ? 'rgba(200,169,110,0.2)' : hovered ? tokens.borderHover : tokens.border}`,
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
      background: disabled ? 'rgba(255,255,255,0.06)' : hovered ? tokens.accentLight : tokens.accent,
      color: disabled ? tokens.textDisabled : '#0C0E12',
      border: 'none',
    },
    ghost: {
      background: hovered ? tokens.bgCardHover : 'transparent',
      color: hovered ? tokens.textPrimary : tokens.textSecondary,
      border: `1px solid ${hovered ? tokens.borderHover : tokens.border}`,
    },
    danger: {
      background: hovered ? 'rgba(212,122,107,0.2)' : tokens.redDim,
      color: tokens.red,
      border: `1px solid rgba(212,122,107,0.2)`,
    },
    accent: {
      background: hovered ? 'rgba(200,169,110,0.18)' : tokens.accentDim,
      color: tokens.accent,
      border: `1px solid rgba(200,169,110,0.2)`,
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
          <option key={o.value} value={o.value} style={{ background: '#1a1c22' }}>
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
    <div style={{ height, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', width: '100%' }}>
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
      border: `2px solid rgba(255,255,255,0.08)`,
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
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-up"
        style={{
          background: '#141720',
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radiusXl,
          padding: '28px',
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
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
export function AICard({ text, loading, onRefresh, label = 'ANCHOR' }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(200,169,110,0.09) 0%, rgba(200,169,110,0.03) 100%)',
      border: '1px solid rgba(200,169,110,0.18)',
      borderRadius: tokens.radiusLg,
      padding: '18px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle, rgba(200,169,110,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
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
            <p style={{ fontSize: '14px', color: tokens.textPrimary, lineHeight: 1.65, margin: 0 }}>{text}</p>
          )}
        </div>
      </div>
      {onRefresh && !loading && (
        <button onClick={onRefresh} style={{ marginTop: '12px', fontSize: '11px', color: tokens.accent, background: tokens.accentDim, border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
          ↻ Refresh
        </button>
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

// ─── StatusTag helpers ────────────────────────────────────────────────────────
export const statusColors = {
  active:   { bg: 'rgba(109,191,158,0.12)', text: '#6DBF9E' },
  stalled:  { bg: 'rgba(212,122,107,0.12)', text: '#D47A6B' },
  planning: { bg: 'rgba(91,143,212,0.12)',  text: '#5B8FD4' },
  complete: { bg: 'rgba(155,133,201,0.12)', text: '#9B85C9' },
  paused:   { bg: 'rgba(237,232,224,0.08)', text: 'rgba(237,232,224,0.4)' },
};

export const priorityColors = {
  critical: { bg: 'rgba(212,122,107,0.12)', text: '#D47A6B' },
  high:     { bg: 'rgba(200,169,110,0.12)', text: '#C8A96E' },
  medium:   { bg: 'rgba(91,143,212,0.12)',  text: '#5B8FD4' },
  low:      { bg: 'rgba(237,232,224,0.06)', text: 'rgba(237,232,224,0.35)' },
};
