/**
 * The look of the browser, as chosen by the user: colours, shapes, density, fonts and layout.
 * Turned into CSS custom properties shared by the browser UI, the internal pages and the popups,
 * and into the few colours the main process needs (window background, system title bar buttons).
 */

export type Palette = 'standard' | 'warm' | 'contrast';
export type Backdrop = 'neutral' | 'tint' | 'gradient';
export type Density = 'compact' | 'normal' | 'comfortable';
export type UiFont = 'inter' | 'system' | 'rounded' | 'serif' | 'mono';
/** inline: tabs and address in one row; top: tabs above the address; side: vertical tabs. */
export type TabsLayout = 'inline' | 'top' | 'side';
export type RailPosition = 'left' | 'right' | 'hidden';
export type CanvasStyle = 'floating' | 'flush';
export type AppIconStyle = 'mono' | 'color';
export type NewTabBackground = 'plain' | 'tint' | 'gradient';

export const TOOLBAR_ITEMS = {
  back: { label: 'Indietro', icon: 'arrowLeft' },
  forward: { label: 'Avanti', icon: 'arrowRight' },
  reload: { label: 'Ricarica', icon: 'reload' },
  home: { label: 'Pagina iniziale', icon: 'home' },
  newTab: { label: 'Nuova scheda', icon: 'plus' },
  shield: { label: 'Protezioni', icon: 'shieldCheck' },
  media: { label: 'Audio e video', icon: 'volume' },
  downloads: { label: 'Download', icon: 'download' },
  tabSearch: { label: 'Cerca tra le schede', icon: 'chevronDown' },
  bookmarks: { label: 'Preferiti', icon: 'bookmark' },
  history: { label: 'Cronologia', icon: 'history' },
  ai: { label: 'Assistente IA', icon: 'sparkles' },
  extensions: { label: 'Estensioni', icon: 'puzzle' },
  panel: { label: 'Pannello kSuite', icon: 'panel' },
} as const;

export type ToolbarItem = keyof typeof TOOLBAR_ITEMS;
export const TOOLBAR_ITEM_IDS = Object.keys(TOOLBAR_ITEMS) as ToolbarItem[];

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark';
  accentColor: string;
  palette: Palette;
  backdrop: Backdrop;
  density: Density;
  /** Corner radius of the page canvas in px; the other shapes follow it. */
  cornerRadius: number;
  uiFont: UiFont;
  uiFontSize: number;
  tabsLayout: TabsLayout;
  railPosition: RailPosition;
  canvasStyle: CanvasStyle;
  appIconStyle: AppIconStyle;
  sideTabsWidth: number;
  sideTabsCollapsed: boolean;
}

export const ACCENT_PRESETS: Array<{ name: string; color: string }> = [
  { name: 'Lago', color: '#3264f0' },
  { name: 'Ghiacciaio', color: '#0891b2' },
  { name: 'Abete', color: '#16865a' },
  { name: 'Oliva', color: '#6b7f1f' },
  { name: 'Ambra', color: '#c2700c' },
  { name: 'Corallo', color: '#e0533d' },
  { name: 'Lampone', color: '#d0306f' },
  { name: 'Lavanda', color: '#7c4ddb' },
  { name: 'Ardesia', color: '#56606e' },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].color;
export const RADIUS_RANGE = { min: 0, max: 24 } as const;
export const FONT_SIZES = [12, 13, 14, 15] as const;
export const SIDE_TABS_RANGE = { min: 180, max: 420 } as const;

export const UI_FONTS: Record<UiFont, { label: string; stack: string }> = {
  inter: { label: 'Inter', stack: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  system: { label: 'Del sistema', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif" },
  rounded: { label: 'Arrotondato', stack: "ui-rounded, 'SF Pro Rounded', Nunito, 'Varela Round', 'Arial Rounded MT Bold', system-ui, sans-serif" },
  serif: { label: 'Con grazie', stack: "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" },
  mono: { label: 'Monospaziato', stack: "ui-monospace, 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace" },
};

// ---------- Colour helpers ----------

type Rgb = [number, number, number];

export function validHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** `amount` of `b` into `a` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as Rgb);
}

function alpha(color: string, a: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** WCAG relative luminance. */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The accent, adjusted until text in that colour reads on `surface` (at least 3:1 for UI accents, 4.5:1 in high contrast). */
function readableAccent(accent: string, surface: string, dark: boolean, min: number): string {
  let color = accent;
  for (let i = 0; i < 12 && contrast(color, surface) < min; i++) color = mix(color, dark ? '#ffffff' : '#000000', 0.12);
  return color;
}

// ---------- Palettes ----------

interface Neutrals {
  base: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  muted: string;
}

const NEUTRALS: Record<Palette, { light: Neutrals; dark: Neutrals }> = {
  standard: {
    light: { base: '#eceef1', surface: '#ffffff', surface2: '#f3f4f6', surface3: '#e7e9ed', border: '#e2e5e9', borderStrong: '#cbd0d7', text: '#16181c', text2: '#3e434b', muted: '#6b717b' },
    dark: { base: '#0e0f11', surface: '#1a1b1f', surface2: '#232429', surface3: '#2c2e34', border: '#2a2c32', borderStrong: '#3b3e46', text: '#ececef', text2: '#c4c7cd', muted: '#9196a0' },
  },
  warm: {
    light: { base: '#ebe5da', surface: '#fcf9f4', surface2: '#f4efe6', surface3: '#e9e2d5', border: '#e2d9c9', borderStrong: '#cdc1ab', text: '#2a241c', text2: '#4d4436', muted: '#7a6f5e' },
    dark: { base: '#14110d', surface: '#201c17', surface2: '#29241e', surface3: '#332d25', border: '#352f27', borderStrong: '#4a4135', text: '#efe8dd', text2: '#d0c6b7', muted: '#a3988a' },
  },
  contrast: {
    light: { base: '#e6e6e6', surface: '#ffffff', surface2: '#f2f2f2', surface3: '#e0e0e0', border: '#6b6b6b', borderStrong: '#1f1f1f', text: '#000000', text2: '#161616', muted: '#3a3a3a' },
    dark: { base: '#000000', surface: '#0d0d0d', surface2: '#1a1a1a', surface3: '#262626', border: '#8c8c8c', borderStrong: '#e0e0e0', text: '#ffffff', text2: '#f0f0f0', muted: '#cfcfcf' },
  },
};

const DENSITY: Record<Density, { row: number; control: number; tab: number; gap: number; inset: number }> = {
  compact: { row: 38, control: 28, tab: 28, gap: 2, inset: 5 },
  normal: { row: 44, control: 32, tab: 32, gap: 4, inset: 8 },
  comfortable: { row: 52, control: 36, tab: 38, gap: 6, inset: 12 },
};

export function densityMetrics(density: Density): { row: number; control: number; tab: number; gap: number; inset: number } {
  return DENSITY[density];
}

export interface ChromeColors {
  /** Solid colour behind the UI (top row), used for the window and the system title bar buttons. */
  backdrop: string;
  symbol: string;
  surface: string;
}

const PRIVATE: Neutrals & { accent: string } = {
  base: '#1a1428', surface: '#261e3a', surface2: '#30274a', surface3: '#3c3159', border: '#3b3056', borderStrong: '#54457a',
  text: '#f1edf9', text2: '#d8d0ea', muted: '#b3a8cc', accent: '#b692ff',
};

/** Colours the main process needs for the native parts of a window. */
export function chromeColors(s: AppearanceSettings, dark: boolean, isPrivate = false): ChromeColors {
  if (isPrivate) return { backdrop: PRIVATE.base, symbol: PRIVATE.text2, surface: PRIVATE.surface };
  const t = tokens(s, dark);
  return { backdrop: t['--titlebar'], symbol: t['--text-2'], surface: t['--surface'] };
}

/**
 * All CSS custom properties for the chosen appearance. Pages set them on :root; the stylesheets keep
 * equivalent defaults so the first paint looks right before the settings arrive.
 */
export function tokens(s: AppearanceSettings, dark: boolean, isPrivate = false): Record<string, string> {
  const n = isPrivate ? PRIVATE : NEUTRALS[s.palette][dark ? 'dark' : 'light'];
  const highContrast = s.palette === 'contrast';
  const baseAccent = isPrivate ? PRIVATE.accent : validHex(s.accentColor) ? s.accentColor : DEFAULT_ACCENT;
  const accent = readableAccent(baseAccent, n.surface, dark || isPrivate, highContrast ? 4.5 : 3);
  const onAccent = contrast(accent, '#ffffff') >= contrast(accent, '#111318') ? '#ffffff' : '#111318';
  const accentHover = mix(accent, dark || isPrivate ? '#ffffff' : '#000000', 0.12);

  // Backdrop: the colour around the page canvas, lightly tinted with the accent unless neutral.
  const tint = isPrivate || s.backdrop === 'neutral' || highContrast ? 0 : dark ? 0.1 : 0.12;
  const top = mix(n.base, baseAccent, s.backdrop === 'gradient' ? tint * 1.5 : tint);
  const bottom = mix(n.base, baseAccent, s.backdrop === 'gradient' ? tint * 0.35 : tint);
  const d = DENSITY[s.density];
  // The first row stays solid: the system draws the window buttons on that colour.
  const backdrop = s.backdrop === 'gradient' && tint ? `linear-gradient(180deg, ${top} 0px, ${top} ${d.row}px, ${bottom})` : top;

  const r = Math.max(RADIUS_RANGE.min, Math.min(RADIUS_RANGE.max, Math.round(s.cornerRadius)));
  const flush = s.canvasStyle === 'flush';

  return {
    '--font': UI_FONTS[s.uiFont]?.stack ?? UI_FONTS.inter.stack,
    '--fs': `${s.uiFontSize}px`,

    '--titlebar': top,
    '--backdrop': backdrop,
    '--bg': mix(n.surface2, baseAccent, tint ? 0.025 : 0),
    '--surface': n.surface,
    '--surface-2': n.surface2,
    '--surface-3': n.surface3,
    '--chrome-hover': alpha(n.text, dark || isPrivate ? 0.08 : 0.06),
    '--hover': alpha(n.text, dark || isPrivate ? 0.07 : 0.05),
    '--active': alpha(n.text, dark || isPrivate ? 0.12 : 0.09),
    '--border': n.border,
    '--border-strong': n.borderStrong,
    '--text': n.text,
    '--text-2': n.text2,
    '--muted': n.muted,
    '--accent': accent,
    '--accent-hover': accentHover,
    '--accent-soft': alpha(accent, dark || isPrivate ? 0.2 : 0.12),
    '--on-accent': onAccent,
    '--selected': alpha(accent, dark || isPrivate ? 0.22 : 0.12),
    '--focus': `0 0 0 3px ${alpha(accent, highContrast ? 0.8 : 0.3)}`,
    ...(dark || isPrivate
      ? { '--danger': '#ff6b6b', '--danger-soft': 'rgba(255, 107, 107, 0.14)', '--success': '#4fc26b', '--success-soft': 'rgba(79, 194, 107, 0.14)', '--warning': '#f0b449', '--warning-soft': 'rgba(240, 180, 73, 0.14)' }
      : { '--danger': '#d1242f', '--danger-soft': 'rgba(209, 36, 47, 0.1)', '--success': '#1a7f37', '--success-soft': 'rgba(26, 127, 55, 0.11)', '--warning': '#9a5b00', '--warning-soft': 'rgba(191, 120, 0, 0.13)' }),

    '--row-h': `${d.row}px`,
    '--control': `${d.control}px`,
    '--tab-h': `${d.tab}px`,
    '--gap': `${d.gap}px`,
    '--inset': flush ? '0px' : `${d.inset}px`,

    '--r-canvas': flush ? '0px' : `${r}px`,
    '--r-lg': `${r}px`,
    '--r-md': `${Math.round(r * 0.75)}px`,
    '--r-sm': `${Math.round(r * 0.5)}px`,
    '--r-pill': r >= 10 ? '999px' : `${Math.round(r * 0.75)}px`,

    '--shadow-canvas': flush || highContrast
      ? 'none'
      : dark || isPrivate
        ? '0 0 0 1px rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0, 0, 0, 0.35)'
        : `0 0 0 1px ${alpha(n.text, 0.05)}, 0 1px 3px ${alpha(n.text, 0.06)}, 0 8px 28px ${alpha(n.text, 0.07)}`,
    '--shadow-pop': dark || isPrivate ? '0 12px 32px rgba(0, 0, 0, 0.5)' : `0 12px 32px ${alpha(n.text, 0.16)}`,
    '--shadow-card': highContrast ? 'none' : dark || isPrivate ? '0 1px 2px rgba(0, 0, 0, 0.3)' : `0 1px 2px ${alpha(n.text, 0.05)}`,
  };
}

/** Applies the tokens to a document (browser UI, internal pages, popups). */
export function applyTokens(root: HTMLElement, vars: Record<string, string>, dark: boolean): void {
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

export function isDark(theme: AppearanceSettings['theme'], systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark);
}
