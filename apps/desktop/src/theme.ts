/**
 * Palette system.
 *
 * Users pick named colour roles (background, surface, text, muted text, border,
 * accent) instead of writing CSS. This module derives the design tokens the
 * rest of the interface already consumes. Status colours (ok / warn / bad) are
 * intentionally not part of a palette: they stay reserved for status.
 */

export type ThemeMode = "light" | "dark";

export interface PaletteRoles {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  accent: string;
}

export interface CustomPalette {
  id: string;
  name: string;
  mode: ThemeMode;
  roles: PaletteRoles;
}

export interface BuiltinPalette {
  id: string;
  name: string;
  description: string;
  modes: Record<ThemeMode, PaletteRoles>;
}

export const DEFAULT_PALETTE_ID = "atlas";

export const PALETTE_ROLES: { key: keyof PaletteRoles; label: string; hint: string }[] = [
  { key: "background", label: "Background", hint: "The canvas behind panels." },
  { key: "surface", label: "Surface", hint: "Cards, popovers and the composer." },
  { key: "text", label: "Text", hint: "Primary labels and message text." },
  { key: "mutedText", label: "Muted text", hint: "Secondary labels and metadata." },
  { key: "border", label: "Border", hint: "Hairlines around panels and controls." },
  { key: "accent", label: "Accent", hint: "Primary actions, focus and selection." },
];

export const BUILTIN_PALETTES: BuiltinPalette[] = [
  {
    id: "atlas",
    name: "Atlas",
    description: "Quiet blue on cool neutral surfaces. The Atlas default.",
    modes: {
      light: { background: "#f7f8fa", surface: "#ffffff", text: "#101318", mutedText: "#6f7783", border: "#e3e7ed", accent: "#3f6aa8" },
      dark: { background: "#090a0c", surface: "#131418", text: "#f2f4f7", mutedText: "#9aa0a8", border: "#24262c", accent: "#7fa2d6" },
    },
  },
  {
    id: "atlas-mono",
    name: "Atlas Mono",
    description: "Neutral macOS greys with a black or white accent. The Atlas default.",
    modes: {
      light: { background: "#f5f5f7", surface: "#ffffff", text: "#1d1d1f", mutedText: "#6e6e73", border: "#e3e3e8", accent: "#1d1d1f" },
      dark: { background: "#0c0c0d", surface: "#161618", text: "#f5f5f7", mutedText: "#a1a1a6", border: "#2a2a2e", accent: "#f5f5f7" },
    },
  },
  {
    id: "slate",
    name: "Slate",
    description: "Cool blue-grey surfaces with a slate accent.",
    modes: {
      light: { background: "#f7f9fc", surface: "#ffffff", text: "#0f172a", mutedText: "#64748b", border: "#dce4ee", accent: "#334155" },
      dark: { background: "#0a0f15", surface: "#111820", text: "#e8eef5", mutedText: "#8b98a8", border: "#24303c", accent: "#c8d5e3" },
    },
  },
  {
    id: "paper",
    name: "Paper",
    description: "Warm paper tones for daylight.",
    modes: {
      light: { background: "#fbf8f1", surface: "#fffdf8", text: "#1c1917", mutedText: "#7c7265", border: "#e7e0d2", accent: "#57534e" },
      dark: { background: "#131110", surface: "#1b1816", text: "#f2ece2", mutedText: "#a3968a", border: "#322c27", accent: "#d9cdbf" },
    },
  },
  {
    id: "moss",
    name: "Moss",
    description: "A quiet green cast on neutral surfaces.",
    modes: {
      light: { background: "#f7faf6", surface: "#ffffff", text: "#10201a", mutedText: "#5f7268", border: "#dbe6dd", accent: "#3d6b57" },
      dark: { background: "#080f0c", surface: "#0f1a15", text: "#e6f2ea", mutedText: "#8aa596", border: "#22332a", accent: "#8fc9a8" },
    },
  },
  {
    id: "iris",
    name: "Iris",
    description: "Violet accent on cool neutral surfaces.",
    modes: {
      light: { background: "#faf9ff", surface: "#ffffff", text: "#17142a", mutedText: "#6b6785", border: "#e3e0f0", accent: "#5b4bb7" },
      dark: { background: "#0b0a12", surface: "#141221", text: "#eeecf9", mutedText: "#9a95b5", border: "#2a2740", accent: "#a99bf5" },
    },
  },
  {
    id: "ember",
    name: "Ember",
    description: "Rust accent on warm neutral surfaces.",
    modes: {
      light: { background: "#fdfaf7", surface: "#ffffff", text: "#211812", mutedText: "#7c6a5d", border: "#eee1d7", accent: "#a34d1f" },
      dark: { background: "#120d0a", surface: "#1b1410", text: "#f7ece4", mutedText: "#ab9385", border: "#362820", accent: "#e89a6a" },
    },
  },
];

// ---------------------------------------------------------------- colour maths
type RGB = [number, number, number];

function parseHex(value: string): RGB | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: RGB) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

export function normalizeHex(value: string): string | null {
  return parseHex(value) ? toHex(parseHex(value) as RGB).toLowerCase() : null;
}

export function isHexColor(value: string) {
  return parseHex(value) !== null;
}

/** Mix `b` into `a`; weight is the amount of b (0–1). */
export function mixColors(a: string, b: string, weight: number) {
  const ca = parseHex(a), cb = parseHex(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, weight));
  return toHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

export function alphaColor(value: string, alpha: number) {
  const rgb = parseHex(value);
  if (!rgb) return value;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Ink that stays readable on `background`. */
export function readableInk(background: string) {
  const rgb = parseHex(background);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0a0a0a" : "#ffffff";
}

export function normalizeRoles(roles: PaletteRoles): PaletteRoles | null {
  const out = {} as PaletteRoles;
  for (const { key } of PALETTE_ROLES) {
    const value = normalizeHex(roles[key] || "");
    if (!value) return null;
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------- tokens
const SHADOWS: Record<ThemeMode, Record<string, string>> = {
  light: {
    "--shadow": "0 1px 1px rgba(0, 0, 0, 0.04)",
    "--shadow-md": "0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 4px 16px -4px rgba(0, 0, 0, 0.10)",
    "--shadow-lg": "0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 18px 48px -12px rgba(0, 0, 0, 0.22)",
    "--neu-lo": "rgba(11, 13, 18, 0.12)",
  },
  dark: {
    "--shadow": "0 1px 1px rgba(0, 0, 0, 0.3)",
    "--shadow-md": "0 0 0 0.5px rgba(255, 255, 255, 0.06), 0 6px 20px -6px rgba(0, 0, 0, 0.6)",
    "--shadow-lg": "0 0 0 0.5px rgba(255, 255, 255, 0.09), 0 22px 56px -14px rgba(0, 0, 0, 0.75)",
    "--neu-lo": "rgba(0, 0, 0, 0.6)",
  },
};

/** Turn the six named roles into every design token the UI reads. */
export function paletteTokens(roles: PaletteRoles, mode: ThemeMode, options: { neutralPrimary?: boolean } = {}): Record<string, string> {
  const { background, surface, text, mutedText, border, accent } = roles;
  const onAccent = readableInk(accent);
  const primary = options.neutralPrimary ? text : accent;
  const onPrimary = options.neutralPrimary ? readableInk(text) : onAccent;
  const primaryHover = options.neutralPrimary
    ? mixColors(primary, mode === "dark" ? "#ffffff" : background, 0.14)
    : mode === "dark" ? mixColors(accent, "#ffffff", 0.14) : mixColors(accent, "#000000", 0.14);
  return {
    "--base": background,
    "--bg": background,
    "--sidebar": mode === "dark" ? mixColors(background, surface, 0.45) : mixColors(background, text, 0.025),
    "--surface": surface,
    "--surface-2": mode === "dark" ? surface : mixColors(surface, text, 0.02),
    "--control": surface,
    "--sunken": mode === "dark" ? background : mixColors(background, text, 0.035),
    "--glass": surface,
    "--text": text,
    "--text-2": mutedText,
    "--text-3": mixColors(mutedText, background, 0.28),
    "--border": border,
    "--border-strong": mixColors(border, text, 0.28),
    "--hover": mixColors(surface, text, 0.04),
    "--active": mixColors(surface, text, mode === "dark" ? 0.075 : 0.06),
    "--selected": mixColors(surface, text, mode === "dark" ? 0.06 : 0.05),
    "--accent": accent,
    "--accent-2": accent,
    "--accent-bg": alphaColor(accent, mode === "dark" ? 0.10 : 0.07),
    "--on-accent": onAccent,
    "--primary": primary,
    "--primary-hover": primaryHover,
    "--on-primary": onPrimary,
    "--info-bg": mixColors(surface, text, mode === "dark" ? 0.11 : 0.065),
    "--ring": alphaColor(accent, mode === "dark" ? 0.32 : 0.22),
    ...SHADOWS[mode],
  };
}

// ---------------------------------------------------------------- palette selection
export function defaultRoles(mode: ThemeMode): PaletteRoles {
  return { ...BUILTIN_PALETTES[0].modes[mode] };
}

export function newPaletteId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function hasRoles(value: any): value is PaletteRoles {
  return !!value && PALETTE_ROLES.every(({ key }) => typeof value[key] === "string" && isHexColor(value[key]));
}

/** Read custom palettes defensively so malformed settings never break the UI. */
export function customPalettesFrom(settings: Record<string, any> | undefined): CustomPalette[] {
  const raw = settings?.["appearance.custom_palettes"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: any) => {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string" || !hasRoles(item.roles)) return [];
    const mode: ThemeMode = item.mode === "light" ? "light" : "dark";
    return [{ id: item.id, name: item.name, mode, roles: { ...item.roles } }];
  });
}

export function resolvePalette(id: string | undefined, custom: CustomPalette[], mode: ThemeMode): { id: string; name: string; roles: PaletteRoles; custom: boolean } {
  const own = custom.find((p) => p.id === id);
  if (own && own.mode === mode) return { id: own.id, name: own.name, roles: own.roles, custom: true };
  const builtin = BUILTIN_PALETTES.find((p) => p.id === id) || BUILTIN_PALETTES.find((p) => p.id === DEFAULT_PALETTE_ID) || BUILTIN_PALETTES[0];
  return { id: builtin.id, name: builtin.name, roles: builtin.modes[mode], custom: false };
}
