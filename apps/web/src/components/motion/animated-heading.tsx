'use client';

import { useReducedMotion } from 'motion/react';
import { useSyncExternalStore } from 'react';

import BlurText from './blur-text';

const subscribe = () => () => {};

/**
 * Decorative entrance for a heading. The real text is always in the accessible tree;
 * the animated copy is hidden from assistive tech and skipped for reduced-motion users.
 */
export function AnimatedHeading({ text, className }: { text: string; className?: string }) {
  const reduceMotion = useReducedMotion();
  // Server render and first client render stay static so markup matches during hydration.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (!mounted || reduceMotion) {
    return <h1 className={className}>{text}</h1>;
  }

  return (
    <h1 className={className} aria-label={text}>
      <span aria-hidden="true">
        <BlurText text={text} delay={40} stepDuration={0.12} />
      </span>
    </h1>
  );
}
