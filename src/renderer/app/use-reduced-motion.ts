// Reduced motion for the whole window (M2-14 #79, UI_SPEC §6.6): the profile's setting, or the
// OS `prefers-reduced-motion` when the setting is "follow system".
//
// Atlas Realm has no animations yet. App sets `data-motion="reduced"` on the root element,
// which switches CSS transitions and animations off (app.css), and later animation code (zoom
// easing, decorative loops, force layouts) asks useReducedMotion before it moves anything.
import { useEffect } from 'react';

import { useStore } from '../state/use-store';
import { resolveReducedMotion, type Comfort } from '../world/comfort';
import { useMediaQuery } from './use-media-query';

export const OS_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when motion should be reduced right now. */
export function useReducedMotion(comfort: Comfort): boolean {
  const osPrefersReduced = useMediaQuery(OS_REDUCED_MOTION);
  const setting = useStore(comfort.store).preferences.reducedMotion;
  return resolveReducedMotion(setting, osPrefersReduced);
}

/** Keeps the root element's `data-motion` in step with useReducedMotion. */
export function useMotionAttribute(comfort: Comfort): void {
  const reduced = useReducedMotion(comfort);
  useEffect(() => {
    document.documentElement.dataset['motion'] = reduced ? 'reduced' : 'full';
  }, [reduced]);
}
