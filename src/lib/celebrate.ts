/**
 * Strynkix Live Books — confetti for real student wins (lesson complete,
 * quiz passed). The library loads only when first needed, and nothing runs
 * when the device asks for reduced motion.
 */

const COLORS = ['#3b3fe4', '#8b6cf6', '#ffb020', '#12b5a3', '#ff7a59'];

export async function celebrate(kind: 'lesson' | 'quiz' = 'lesson') {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try {
    const confetti = (await import('canvas-confetti')).default;
    const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 80 };
    if (kind === 'quiz') {
      confetti({ ...base, particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } });
      confetti({ ...base, particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } });
    } else {
      confetti({ ...base, particleCount: 90, spread: 75, startVelocity: 38, origin: { y: 0.7 } });
    }
  } catch {
    // Confetti is decoration; never let it break the page.
  }
}
