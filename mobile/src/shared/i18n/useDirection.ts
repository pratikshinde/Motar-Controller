import { useTranslation } from 'react-i18next';
import { isRtl } from './languages';

const FLIP = { transform: [{ scaleX: -1 }] } as const;

/**
 * Layout direction for the current language. `dir` goes on the app's root view
 * (React Native's `direction` style mirrors every row inside it, no restart
 * needed); `flip` mirrors a directional icon such as a "next" arrow.
 */
export function useDirection() {
  const { i18n } = useTranslation();
  const rtl = isRtl(i18n.language);
  return { rtl, dir: (rtl ? 'rtl' : 'ltr') as 'rtl' | 'ltr', flip: rtl ? FLIP : undefined };
}
