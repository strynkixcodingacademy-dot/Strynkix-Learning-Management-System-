/**
 * Course identity: every course is a bound volume. Its cloth colour follows its
 * subject (falling back to a stable colour from its id), so a course looks the
 * same on the shelf, on its title page and in every list.
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
import { cx } from './tones';

export type Cloth = 'cobalt' | 'oxblood' | 'forest' | 'ochre' | 'teal' | 'ink' | 'rust' | 'plum';

export const CLOTH_BG: Record<Cloth, string> = {
  cobalt: 'bg-cloth-cobalt',
  oxblood: 'bg-cloth-oxblood',
  forest: 'bg-cloth-forest',
  ochre: 'bg-cloth-ochre',
  teal: 'bg-cloth-teal',
  ink: 'bg-cloth-ink',
  rust: 'bg-cloth-rust',
  plum: 'bg-cloth-plum',
};

const FALLBACK_CLOTHS: Cloth[] = ['cobalt', 'forest', 'oxblood', 'teal', 'ochre', 'plum', 'rust', 'ink'];

const TOPICS: Array<[RegExp, LucideIcon, Cloth]> = [
  [/\bc\+\+|\bcpp\b|\bc programming|systems programming/i, Cpu, 'ink'],
  [/\bjava\b(?!script)|spring/i, Coffee, 'rust'],
  [/python|terminal|shell|bash/i, Terminal, 'forest'],
  [/javascript|typescript|\bjs\b|\bts\b/i, Braces, 'ochre'],
  [/html|css|frontend|front-end/i, Globe, 'rust'],
  [/react|full[- ]?stack|web\b|architecture|next|node/i, Layers, 'cobalt'],
  [/data|sql|database|firestore|mongo/i, Database, 'teal'],
  [/secur|cyber|auth/i, ShieldCheck, 'oxblood'],
  [/android|ios|mobile|flutter/i, Smartphone, 'plum'],
];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

type CourseLike = Pick<Course, 'id' | 'title'> & { tags?: string[] };

export function courseIdentity(course: CourseLike): { cloth: Cloth; Icon: LucideIcon } {
  const text = `${course.title} ${(course.tags ?? []).join(' ')}`;
  const topic = TOPICS.find(([re]) => re.test(text));
  return { cloth: topic?.[2] ?? FALLBACK_CLOTHS[hash(course.id) % FALLBACK_CLOTHS.length], Icon: topic?.[1] ?? BookOpen };
}

/** Small cloth plate with the subject's stamp, for lists and tables. */
export function CourseIcon({ course, size = 'md' }: { course: CourseLike; size?: 'sm' | 'md' | 'lg' }) {
  const { cloth, Icon } = courseIdentity(course);
  const box = { sm: 'h-9 w-7', md: 'h-12 w-9', lg: 'h-16 w-12' }[size];
  const icon = { sm: 'w-3.5 h-3.5', md: 'w-4.5 h-4.5', lg: 'w-6 h-6' }[size];
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] pl-1 text-foil', box, CLOTH_BG[cloth])} aria-hidden="true">
      <span className="absolute inset-y-0 left-0 w-1 bg-black/20" />
      <Icon className={icon} strokeWidth={1.75} />
    </span>
  );
}

/** The full cover: a bound volume with the course title stamped on it. Decorative: the title is repeated as real text beside it. */
export function CourseCover({ course, level, className }: { course: CourseLike; level?: string; className?: string }) {
  const { cloth, Icon } = courseIdentity(course);
  return (
    <span aria-hidden="true" className={cx('cloth-frame block aspect-[3/4] overflow-hidden rounded-[3px] [container-type:inline-size]', CLOTH_BG[cloth], className)}>
      <span className="absolute inset-y-0 left-0 w-[7%] bg-black/25" />
      <span className="absolute inset-y-0 left-[7%] w-px bg-white/10" />
      <span className="absolute inset-0 flex flex-col pb-[9%] pl-[16%] pr-[11%] pt-[13%]">
        <span data-title={course.title} className="block max-h-[4.5em] overflow-hidden font-display text-[12cqw] font-[560] leading-[1.12] tracking-[-0.01em] after:content-[attr(data-title)]" />
        <span className="mt-[9%] block h-px w-[22%] shrink-0 bg-foil/45" />
        {level && <span className="mt-[6%] font-display text-[7cqw] capitalize italic opacity-75">{level}</span>}
        <span className="mt-auto flex items-center gap-[0.4em] text-[5.5cqw] font-medium opacity-70">
          <Icon className="h-[1.1em] w-[1.1em]" strokeWidth={1.75} />Strynkix
        </span>
      </span>
    </span>
  );
}
