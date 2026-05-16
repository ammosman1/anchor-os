// src/lib/tokens.js
// Anchor Design System — Warm light, editorial, premium

export const tokens = {
  // Backgrounds
  bg:          '#F7F5F0',           // warm cream
  bgCard:      '#FFFFFF',           // pure white cards
  bgCardHover: '#F9F8F5',
  bgGlass:     'rgba(255,255,255,0.75)',
  bgInput:     '#F0EDE8',           // warm off-white inputs
  bgNav:       '#FEFCF8',           // top bar, slightly warmer than bg

  // Borders
  border:      'rgba(0,0,0,0.08)',
  borderHover: 'rgba(0,0,0,0.15)',
  borderFocus: 'rgba(154,120,48,0.45)',

  // Accent — dark warm gold (readable on light bg)
  accent:      '#9A7830',
  accentLight: '#AE8C3C',
  accentDim:   'rgba(154,120,48,0.10)',
  accentGlow:  'rgba(154,120,48,0.06)',

  // Status colors — darkened for light mode contrast
  green:       '#277A56',
  greenDim:    'rgba(39,122,86,0.10)',
  blue:        '#2660B0',
  blueDim:     'rgba(38,96,176,0.10)',
  red:         '#B83220',
  redDim:      'rgba(184,50,32,0.10)',
  amber:       '#B07010',
  amberDim:    'rgba(176,112,16,0.10)',
  purple:      '#6040A8',
  purpleDim:   'rgba(96,64,168,0.10)',

  // Text
  textPrimary:   '#1C1814',
  textSecondary: 'rgba(28,24,20,0.58)',
  textMuted:     'rgba(28,24,20,0.38)',
  textDisabled:  'rgba(28,24,20,0.22)',

  // Track (progress bars, range input background)
  track:       'rgba(0,0,0,0.08)',

  // Spacing
  radiusSm:  '6px',
  radiusMd:  '10px',
  radiusLg:  '14px',
  radiusXl:  '20px',

  // Shadows — lighter for light mode
  shadowCard: '0 1px 3px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.07)',
  shadowGlow: '0 0 24px rgba(154,120,48,0.08)',
  shadowNav:  '0 1px 0 rgba(0,0,0,0.06)',
};

export const fonts = {
  display: "'Playfair Display', Georgia, serif",
  body:    "'DM Sans', 'Helvetica Neue', sans-serif",
};

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
    color-scheme: light;
  }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.14); border-radius: 99px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.22); }

  input, textarea, select, button { font-family: inherit; }

  input[type=range] {
    -webkit-appearance: none;
    height: 3px;
    border-radius: 99px;
    background: rgba(0,0,0,0.10);
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
    box-shadow: 0 1px 6px rgba(154,120,48,0.35);
  }

  select option { background: #fff; color: #1C1814; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes slideInRight {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  .fade-up        { animation: fadeUp 0.4s ease both; }
  .fade-in        { animation: fadeIn 0.3s ease both; }
  .slide-in-right { animation: slideInRight 0.22s cubic-bezier(0.4,0,0.2,1) both; }
  .pulsing        { animation: pulse 1.8s ease-in-out infinite; }
  .spinning       { animation: spin 1s linear infinite; }

  .stagger-1 { animation-delay: 0.05s; }
  .stagger-2 { animation-delay: 0.10s; }
  .stagger-3 { animation-delay: 0.15s; }
  .stagger-4 { animation-delay: 0.20s; }
  .stagger-5 { animation-delay: 0.25s; }
  .stagger-6 { animation-delay: 0.30s; }
`;
