'use client';

import React, { useEffect, useState } from 'react';
import NumberFlow from '@number-flow/react';

/**
 * A number that counts up from 0 when it first appears and rolls smoothly to
 * new values afterwards. NumberFlow skips the animation under "reduce motion".
 */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return <NumberFlow value={shown} className={className} aria-label={String(value)} />;
}
