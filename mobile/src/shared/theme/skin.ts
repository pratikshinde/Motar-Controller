import { ajantaHome } from '@/config/ajantaHome';

/**
 * For a screen both brands share: `skin(ajantaValue, otherValue)` gives Ajanta's value in Ajanta's app and the other brand's own
 * value everywhere else, so Ajanta can follow its brand tokens while Swati's screens stay exactly as they were.
 */
export const skin = <T,>(ajanta: T, other: T): T => (ajantaHome ? ajanta : other);
