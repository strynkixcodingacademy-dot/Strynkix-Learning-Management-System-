'use client';

/**
 * Strynkix Live Books — app-wide toasts (sonner), styled with the theme
 * tokens so they follow light and dark. Call `toast(...)` from 'sonner'.
 */

import React from 'react';
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      closeButton
      toastOptions={{
        style: {
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
          border: '1px solid var(--color-line)',
          boxShadow: 'var(--shadow-float)',
          borderRadius: '14px',
          fontFamily: 'var(--font-sans)',
        },
      }}
    />
  );
}
