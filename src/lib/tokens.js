// src/lib/tokens.js
// Anchor Design System — Warm dark, premium, calm

export const tokens = {
  // Backgrounds
  bg:          '#0C0E12',
  bgCard:      'rgba(255,255,255,0.035)',
  bgCardHover: 'rgba(255,255,255,0.06)',
  bgGlass:     'rgba(255,255,255,0.025)',
  bgInput:     'rgba(255,255,255,0.05)',

  // Borders
  border:      'rgba(255,255,255,0.07)',
  borderHover: 'rgba(255,255,255,0.13)',
  borderFocus: 'rgba(200,169,110,0.4)',

  // Accent — warm gold
  accent:      '#C8A96E',
  accentLight: '#D4BB8A',
  accentDim:   'rgba(200,169,110,0.12)',
  accentGlow:  'rgba(200,169,110,0.06)',

  // Status colors
  green:       '#6DBF9E',
  greenDim:    'rgba(109,191,158,0.12)',
  blue:        '#5B8FD4',
  blueDim:     'rgba(91,143,212,0.12)',
  red:         '#D47A6B',
  redDim:      'rgba(212,122,107,0.12)',
  amber:       '#D4A96B',
  amberDim:    'rgba(212,169,107,0.12)',
  purple:      '#9B85C9',
  purpleDim:   'rgba(155,133,201,0.12)',

  // Text
  textPrimary:   '#EDE8E0',
  textSecondary: 'rgba(237,232,224,0.52)',
  textMuted:     'rgba(237,232,224,0.28)',
  textDisabled:  'rgba(237,232,224,0.18)',

  // Spacing
  radiusSm:  '6px',
  radiusMd:  '10px',
  radiusLg:  '14px',
  radiusXl:  '20px',

  // Shadows
  shadowCard: '0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.2)',
  shadowGlow: '0 0 24px rgba(200,169,110,0.08)',
};

export const fonts = {
  display: "'Playfair Display', Georgia, serif",
  body:    "'DM Sans', 'Helvetica Neue', sans-serif",
};

// Global CSS injected once at app root
export const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body, #root {
    height: 100%;
    background: ${tokens.bg};
    color: ${tokens.textPrimary};
    font-family: ${fonts.body};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }

  input, textarea, select, button { font-family: inherit; }

  input[type=range] {
    -webkit-appearance: none;
    height: 3px;
    border-radius: 99px;
    background: rgba(255,255,255,0.08);
    outline: none;
    cursor: pointer;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${tokens.accent};
    cursor: pointer;
    box-shadow: 0 0 8px rgba(200,169,110,0.4);
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  .fade-up   { animation: fadeUp 0.4s ease both; }
  .fade-in   { animation: fadeIn 0.3s ease both; }
  .pulsing   { animation: pulse 1.8s ease-in-out infinite; }
  .spinning  { animation: spin 1s linear infinite; }

  .stagger-1 { animation-delay: 0.05s; }
  .stagger-2 { animation-delay: 0.10s; }
  .stagger-3 { animation-delay: 0.15s; }
  .stagger-4 { animation-delay: 0.20s; }
  .stagger-5 { animation-delay: 0.25s; }
  .stagger-6 { animation-delay: 0.30s; }
`;
