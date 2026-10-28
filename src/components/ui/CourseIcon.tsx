/**
 * Course identity: a deterministic accent ("book spine" colour) and a topic icon,
 * so every course is recognisable without hand-assigned artwork.
 */

import React from 'react';
import {
  BookOpen,
  Braces,
  Coffee,
  Cpu,
  Database,
  Globe,
  Layers,
  ShieldCheck,
  Smartphone,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { Course } from '@/types/domain';
import { cx, Tone } from './tones';

const SPINE_TONES: Tone[] = ['brand', 'teal', 'coral', 'lavender', 'success', 'warning'];

const TOPICS: Array<[RegExp, LucideIcon]> = [
  [/\bc\+\+|\bcpp\b|\bc programming|systems?\b/i, Cpu],
  [/\bjava\b(?!script)|spring/i, Coffee],
  [/python|terminal|shell|bash/i, Terminal],
  [/html|css|web\b|frontend|front-end/i, Globe],
  [/javascript|typescript|\bjs\b|\bts\b|node/i, Braces],
  [/react|advanced|full[- ]?stack|architecture|next/i, Layers],
  [/data|sql|database|firestore|mongo/i, Database],
  [/secur|cyber|auth/i, ShieldCheck],
  [/android|ios|mobile|flutter/i, Smartphone],
];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

export function courseIdentity(course: Pick<Course, 'id' | 'title'> & { tags?: string[] }): { tone: Tone; Icon: LucideIcon } {
  const text = `${course.title} ${(course.tags ?? []).join(' ')}`;
  const Icon = TOPICS.find(([re]) => re.test(text))?.[1] ?? BookOpen;
  return { tone: SPINE_TONES[hash(course.id) % SPINE_TONES.length], Icon };
}

const PLATE: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-2',
  brand: 'bg-brand-soft text-brand-ink',
  teal: 'bg-teal-soft text-teal-ink',
  coral: 'bg-coral-soft text-coral-ink',
  lavender: 'bg-lavender-soft text-lavender-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
};

export const SPINE: Record<Tone, string> = {
  neutral: 'bg-ink-4',
  brand: 'bg-brand',
  teal: 'bg-teal',
  coral: 'bg-coral',
  lavender: 'bg-lavender',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function CourseIcon({ course, size = 'md' }: { course: Pick<Course, 'id' | 'title'> & { tags?: string[] }; size?: 'sm' | 'md' | 'lg' }) {
  const { tone, Icon } = courseIdentity(course);
  const box = { sm: 'h-9 w-9 rounded-lg', md: 'h-12 w-12 rounded-xl', lg: 'h-16 w-16 rounded-2xl' }[size];
  const icon = { sm: 'w-4.5 h-4.5', md: 'w-6 h-6', lg: 'w-8 h-8' }[size];
  return (
    <span className={cx('inline-flex items-center justify-center shrink-0', box, PLATE[tone])} aria-hidden="true">
      <Icon className={icon} strokeWidth={2} />
    </span>
  );
}
