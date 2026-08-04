import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

type Palette = typeof colors.light;

interface ColorsDefinition {
  light: Palette;
  dark?: Palette;
  radius: number;
}

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts (the scaffold ships light-only by default).
 * When a sibling web artifact's dark tokens are synced into a `dark`
 * key, this hook will automatically switch palettes based on the
 * device's appearance setting.
 */
export function useColors() {
  const scheme = useColorScheme();
  const def = colors as ColorsDefinition;
  const palette: Palette =
    scheme === 'dark' && def.dark ? def.dark : def.light;
  return { ...palette, radius: def.radius };
}
