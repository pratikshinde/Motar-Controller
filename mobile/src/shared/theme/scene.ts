/**
 * The colours of the painted header scene (sky, hills, palms, pump, logo), worked out from the brand tokens in `colors`
 * (brands/<key>/brand.json), so a change to the brand colour changes the whole header and nothing is typed in twice.
 */
import { colors } from './index';
import { mix } from './color';

const dark = colors.primaryDark;
const brand = colors.primary;
const soft = colors.primarySoft;

export const scene = {
  /** The banner behind the scene. */
  banner: dark,
  skyTop: dark,
  skyMid: brand,
  skyLow: soft,
  hillFar: mix(brand, soft, 0.5),
  fieldTop: mix(brand, soft, 0.3),
  fieldBottom: mix(dark, brand, 0.45),
  trunk: mix(dark, '#000000', 0.25),
  frondDark: dark,
  frondLight: mix(dark, brand, 0.5),
  pumpBody: dark,
  pumpDark: mix(dark, '#000000', 0.3),
  pumpLight: mix(dark, brand, 0.55),
  water: mix(soft, '#FFFFFF', 0.6),
  pipe: mix(colors.borderStrong, colors.textMuted, 0.35),
  pipeDark: mix(colors.borderStrong, colors.textMuted, 0.7),
  /** Text and icons drawn on the banner. */
  onBanner: '#FFFFFF',
  /** The profile button on the banner. */
  avatarBg: soft,
  avatarIcon: brand,
  /** The shadow behind banner titles. */
  titleShadow: mix(dark, '#000000', 0.5),
  /** The unread-alerts badge: always red, it is a warning. */
  badge: '#E5352F',
} as const;
