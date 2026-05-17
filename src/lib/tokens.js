// src/lib/tokens.js
// Anchor Design System — Multi-theme with localStorage persistence

// ─── Theme Definitions ────────────────────────────────────────────────────────

const THEME_DEFS = {
  warmCream: {
    bg: '#F7F5F0', bgCard: '#FFFFFF', bgCardHover: '#F9F8F5',
    bgGlass: 'rgba(255,255,255,0.75)', bgInput: '#F0EDE8', bgNav: '#FEFCF8',
    border: 'rgba(0,0,0,0.08)', borderHover: 'rgba(0,0,0,0.15)', borderFocus: 'rgba(154,120,48,0.45)',
    accent: '#9A7830', accentLight: '#AE8C3C', accentDim: 'rgba(154,120,48,0.10)', accentGlow: 'rgba(154,120,48,0.06)',
    green: '#277A56', greenDim: 'rgba(39,122,86,0.10)',
    blue: '#2660B0', blueDim: 'rgba(38,96,176,0.10)',
    red: '#B83220', redDim: 'rgba(184,50,32,0.10)',
    amber: '#B07010', amberDim: 'rgba(176,112,16,0.10)',
    purple: '#6040A8', purpleDim: 'rgba(96,64,168,0.10)',
    textPrimary: '#1C1814', textSecondary: 'rgba(28,24,20,0.58)',
    textMuted: 'rgba(28,24,20,0.38)', textDisabled: 'rgba(28,24,20,0.22)',
    track: 'rgba(0,0,0,0.08)',
    shadowCard: '0 1px 3px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.07)',
    shadowGlow: '0 0 24px rgba(154,120,48,0.08)', shadowNav: '0 1px 0 rgba(0,0,0,0.06)',
    scrollbar: 'rgba(0,0,0,0.14)', scrollbarH: 'rgba(0,0,0,0.22)',
    colorScheme: 'light', selectOptionBg: '#fff', selectOptionColor: '#1C1814',
    rangeTrackBg: 'rgba(0,0,0,0.10)',
  },
  pureLight: {
    bg: '#F4F6FB', bgCard: '#FFFFFF', bgCardHover: '#F7F9FD',
    bgGlass: 'rgba(255,255,255,0.80)', bgInput: '#EBEEF6', bgNav: '#FFFFFF',
    border: 'rgba(0,0,30,0.09)', borderHover: 'rgba(0,0,30,0.16)', borderFocus: 'rgba(38,96,176,0.40)',
    accent: '#2660B0', accentLight: '#3474C8', accentDim: 'rgba(38,96,176,0.10)', accentGlow: 'rgba(38,96,176,0.06)',
    green: '#1E7A48', greenDim: 'rgba(30,122,72,0.10)',
    blue: '#1A50A0', blueDim: 'rgba(26,80,160,0.10)',
    red: '#B02010', redDim: 'rgba(176,32,16,0.10)',
    amber: '#A86000', amberDim: 'rgba(168,96,0,0.10)',
    purple: '#5030A0', purpleDim: 'rgba(80,48,160,0.10)',
    textPrimary: '#10141E', textSecondary: 'rgba(16,20,30,0.58)',
    textMuted: 'rgba(16,20,30,0.38)', textDisabled: 'rgba(16,20,30,0.22)',
    track: 'rgba(0,0,0,0.08)',
    shadowCard: '0 1px 3px rgba(0,0,0,0.05), 0 4px 14px rgba(0,0,0,0.06)',
    shadowGlow: '0 0 24px rgba(38,96,176,0.08)', shadowNav: '0 1px 0 rgba(0,0,0,0.06)',
    scrollbar: 'rgba(0,0,0,0.14)', scrollbarH: 'rgba(0,0,0,0.22)',
    colorScheme: 'light', selectOptionBg: '#fff', selectOptionColor: '#10141E',
    rangeTrackBg: 'rgba(0,0,0,0.10)',
  },
  sage: {
    bg: '#F2F6F2', bgCard: '#FFFFFF', bgCardHover: '#F6FAF6',
    bgGlass: 'rgba(255,255,255,0.78)', bgInput: '#E8F0E8', bgNav: '#F9FCF9',
    border: 'rgba(0,20,0,0.08)', borderHover: 'rgba(0,20,0,0.15)', borderFocus: 'rgba(39,122,86,0.40)',
    accent: '#277A56', accentLight: '#348C65', accentDim: 'rgba(39,122,86,0.10)', accentGlow: 'rgba(39,122,86,0.06)',
    green: '#1A6840', greenDim: 'rgba(26,104,64,0.10)',
    blue: '#2060A0', blueDim: 'rgba(32,96,160,0.10)',
    red: '#A82818', redDim: 'rgba(168,40,24,0.10)',
    amber: '#906010', amberDim: 'rgba(144,96,16,0.10)',
    purple: '#5838A0', purpleDim: 'rgba(88,56,160,0.10)',
    textPrimary: '#141C14', textSecondary: 'rgba(20,28,20,0.58)',
    textMuted: 'rgba(20,28,20,0.38)', textDisabled: 'rgba(20,28,20,0.22)',
    track: 'rgba(0,0,0,0.08)',
    shadowCard: '0 1px 3px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.07)',
    shadowGlow: '0 0 24px rgba(39,122,86,0.08)', shadowNav: '0 1px 0 rgba(0,0,0,0.06)',
    scrollbar: 'rgba(0,0,0,0.14)', scrollbarH: 'rgba(0,0,0,0.22)',
    colorScheme: 'light', selectOptionBg: '#fff', selectOptionColor: '#141C14',
    rangeTrackBg: 'rgba(0,0,0,0.10)',
  },
  midnight: {
    bg: '#0C0E12', bgCard: '#141720', bgCardHover: '#1C2030',
    bgGlass: 'rgba(20,23,32,0.75)', bgInput: '#1A1E28', bgNav: '#10121A',
    border: 'rgba(255,255,255,0.08)', borderHover: 'rgba(255,255,255,0.14)', borderFocus: 'rgba(200,169,110,0.45)',
    accent: '#C8A96E', accentLight: '#D4BA7E', accentDim: 'rgba(200,169,110,0.14)', accentGlow: 'rgba(200,169,110,0.08)',
    green: '#4DBF8E', greenDim: 'rgba(77,191,142,0.12)',
    blue: '#5B8FD4', blueDim: 'rgba(91,143,212,0.12)',
    red: '#E06050', redDim: 'rgba(224,96,80,0.12)',
    amber: '#D4A040', amberDim: 'rgba(212,160,64,0.12)',
    purple: '#9070D8', purpleDim: 'rgba(144,112,216,0.12)',
    textPrimary: '#EDE9E0', textSecondary: 'rgba(237,233,224,0.60)',
    textMuted: 'rgba(237,233,224,0.38)', textDisabled: 'rgba(237,233,224,0.22)',
    track: 'rgba(255,255,255,0.08)',
    shadowCard: '0 1px 3px rgba(0,0,0,0.30), 0 4px 14px rgba(0,0,0,0.35)',
    shadowGlow: '0 0 24px rgba(200,169,110,0.10)', shadowNav: '0 1px 0 rgba(0,0,0,0.30)',
    scrollbar: 'rgba(255,255,255,0.14)', scrollbarH: 'rgba(255,255,255,0.22)',
    colorScheme: 'dark', selectOptionBg: '#1A1E28', selectOptionColor: '#EDE9E0',
    rangeTrackBg: 'rgba(255,255,255,0.10)',
  },
  ocean: {
    bg: '#EFF5FA', bgCard: '#FFFFFF', bgCardHover: '#F4F9FD',
    bgGlass: 'rgba(255,255,255,0.80)', bgInput: '#E4EFF8', bgNav: '#FFFFFF',
    border: 'rgba(0,16,32,0.08)', borderHover: 'rgba(0,16,32,0.15)', borderFocus: 'rgba(11,138,156,0.40)',
    accent: '#0B8A9C', accentLight: '#1AA0B2', accentDim: 'rgba(11,138,156,0.10)', accentGlow: 'rgba(11,138,156,0.06)',
    green: '#1A7A50', greenDim: 'rgba(26,122,80,0.10)',
    blue: '#1060A0', blueDim: 'rgba(16,96,160,0.10)',
    red: '#B02020', redDim: 'rgba(176,32,32,0.10)',
    amber: '#A06010', amberDim: 'rgba(160,96,16,0.10)',
    purple: '#5038A0', purpleDim: 'rgba(80,56,160,0.10)',
    textPrimary: '#0A1820', textSecondary: 'rgba(10,24,32,0.58)',
    textMuted: 'rgba(10,24,32,0.38)', textDisabled: 'rgba(10,24,32,0.22)',
    track: 'rgba(0,0,0,0.08)',
    shadowCard: '0 1px 3px rgba(0,0,0,0.05), 0 4px 14px rgba(0,0,0,0.06)',
    shadowGlow: '0 0 24px rgba(11,138,156,0.08)', shadowNav: '0 1px 0 rgba(0,0,0,0.06)',
    scrollbar: 'rgba(0,0,0,0.14)', scrollbarH: 'rgba(0,0,0,0.22)',
    colorScheme: 'light', selectOptionBg: '#fff', selectOptionColor: '#0A1820',
    rangeTrackBg: 'rgba(0,0,0,0.10)',
  },
};

export const THEME_LIST = [
  { id: 'warmCream', name: 'Warm Cream',  description: 'Warm editorial, default' },
  { id: 'pureLight', name: 'Pure Light',  description: 'Clean white, navy accent' },
  { id: 'sage',      name: 'Sage',        description: 'Fresh forest green tones' },
  { id: 'midnight',  name: 'Midnight',    description: 'Dark mode with gold' },
  { id: 'ocean',     name: 'Ocean',       description: 'Cool blue-teal palette' },
];

export function setTheme(id) {
  try { localStorage.setItem('anchorTheme', id); } catch {}
  window.location.reload();
}

const _id = (() => { try { return localStorage.getItem('anchorTheme') || 'warmCream'; } catch { return 'warmCream'; } })();
const _t = THEME_DEFS[_id] || THEME_DEFS.warmCream;

export const tokens = {
  // Backgrounds
  bg:          _t.bg,
  bgCard:      _t.bgCard,
  bgCardHover: _t.bgCardHover,
  bgGlass:     _t.bgGlass,
  bgInput:     _t.bgInput,
  bgNav:       _t.bgNav,
  // Borders
  border:      _t.border,
  borderHover: _t.borderHover,
  borderFocus: _t.borderFocus,
  // Accent
  accent:      _t.accent,
  accentLight: _t.accentLight,
  accentDim:   _t.accentDim,
  accentGlow:  _t.accentGlow,
  // Status
  green:    _t.green,  greenDim:  _t.greenDim,
  blue:     _t.blue,   blueDim:   _t.blueDim,
  red:      _t.red,    redDim:    _t.redDim,
  amber:    _t.amber,  amberDim:  _t.amberDim,
  purple:   _t.purple, purpleDim: _t.purpleDim,
  // Text
  textPrimary:   _t.textPrimary,
  textSecondary: _t.textSecondary,
  textMuted:     _t.textMuted,
  textDisabled:  _t.textDisabled,
  // Misc
  track:     _t.track,
  radiusSm:  '6px',
  radiusMd:  '10px',
  radiusLg:  '14px',
  radiusXl:  '20px',
  shadowCard: _t.shadowCard,
  shadowGlow: _t.shadowGlow,
  shadowNav:  _t.shadowNav,
};

export const fonts = {
  display: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
  body:    "'DM Sans', 'Helvetica Neue', sans-serif",
};

export const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body, #root {
    height: 100%;
    background: ${_t.bg};
    color: ${_t.textPrimary};
    font-family: 'DM Sans', 'Helvetica Neue', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    color-scheme: ${_t.colorScheme};
  }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${_t.scrollbar}; border-radius: 99px; }
  ::-webkit-scrollbar-thumb:hover { background: ${_t.scrollbarH}; }

  input, textarea, select, button { font-family: inherit; }

  input[type=range] {
    -webkit-appearance: none;
    height: 3px;
    border-radius: 99px;
    background: ${_t.rangeTrackBg};
    outline: none;
    cursor: pointer;
  }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${_t.accent};
    cursor: pointer;
    box-shadow: 0 1px 6px ${_t.accentGlow};
  }

  select option { background: ${_t.selectOptionBg}; color: ${_t.selectOptionColor}; }

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
