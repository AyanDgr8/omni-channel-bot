/**
 * VoxAgent dark navy design tokens — synced from artifacts/dashboard/src/index.css
 * Both light and dark use the same deep navy palette to keep the operator UI consistent.
 */

const palette = {
  text: '#e0e6eb',
  tint: '#0080ff',

  background: '#0c121d',
  foreground: '#e0e6eb',

  card: '#0f1624',
  cardForeground: '#e0e6eb',

  primary: '#0080ff',
  primaryForeground: '#ffffff',

  secondary: '#1b2232',
  secondaryForeground: '#e0e6eb',

  muted: '#151c28',
  mutedForeground: '#8599ad',

  accent: '#00cc66',
  accentForeground: '#ffffff',

  destructive: '#ef4343',
  destructiveForeground: '#ffffff',

  border: '#1b2232',
  input: '#1b2232',
};

const colors = {
  light: palette,
  dark: palette,
  radius: 4,
};

export default colors;
