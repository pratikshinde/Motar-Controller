import { brand } from './brand';

/**
 * Ajanta's home screen: the blue header with the bell and profile, one pump at a time with its Live cards, and Home /
 * Timer / More at the bottom. It is Ajanta's alone: Swati has a design of its own (`brand.design`), and nothing else
 * that reads this flag changes for it. Turn it off and Ajanta falls back to the original screens.
 */
export const ajantaHome = brand.key === 'ajanta';
