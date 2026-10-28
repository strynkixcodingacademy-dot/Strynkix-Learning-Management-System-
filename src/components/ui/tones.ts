/**
 * Strynkix Live Books — semantic tones.
 * Full class names are spelled out so Tailwind can see them.
 */

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'coral' | 'teal' | 'lavender';

export const TONE_CLASSES: Record<Tone, { soft: string; ink: string; line: string; solid: string; ring: string }> = {
  neutral: { soft: 'bg-surface-muted', ink: 'text-ink-2', line: 'border-line', solid: 'bg-ink-3', ring: 'stroke-ink-4' },
  brand: { soft: 'bg-brand-soft', ink: 'text-brand-ink', line: 'border-brand-line', solid: 'bg-brand', ring: 'stroke-brand' },
  success: { soft: 'bg-success-soft', ink: 'text-success-ink', line: 'border-success-line', solid: 'bg-success', ring: 'stroke-success' },
  warning: { soft: 'bg-warning-soft', ink: 'text-warning-ink', line: 'border-warning-line', solid: 'bg-warning', ring: 'stroke-warning' },
  danger: { soft: 'bg-danger-soft', ink: 'text-danger-ink', line: 'border-danger-line', solid: 'bg-danger', ring: 'stroke-danger' },
  coral: { soft: 'bg-coral-soft', ink: 'text-coral-ink', line: 'border-coral-line', solid: 'bg-coral', ring: 'stroke-coral' },
  teal: { soft: 'bg-teal-soft', ink: 'text-teal-ink', line: 'border-teal-line', solid: 'bg-teal', ring: 'stroke-teal' },
  lavender: { soft: 'bg-lavender-soft', ink: 'text-lavender-ink', line: 'border-lavender-line', solid: 'bg-lavender', ring: 'stroke-lavender' },
};

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
