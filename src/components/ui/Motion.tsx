'use client';

/**
 * Strynkix Live Books — motion helpers (the `motion` library, loaded lazily
 * with only DOM animations). Everything honours the device's "reduce motion"
 * setting through MotionConfig.
 */

import React from 'react';
import { domAnimation, LazyMotion, m, MotionConfig, type Variants } from 'motion/react';

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 30 } },
};

/** A <ul> whose <StaggerItem> children rise in one after another. */
export function StaggerList({ className, children, ...rest }: React.ComponentProps<typeof m.ul>) {
  return (
    <m.ul variants={list} initial="hidden" animate="show" className={className} {...rest}>
      {children}
    </m.ul>
  );
}

export function StaggerItem({ className, children, ...rest }: React.ComponentProps<typeof m.li>) {
  return (
    <m.li variants={item} className={className} {...rest}>
      {children}
    </m.li>
  );
}
