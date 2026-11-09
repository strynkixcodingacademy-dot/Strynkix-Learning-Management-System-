'use client';

/** Section navigation for the Super Admin Command Centre. */

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/tones';

const SECTIONS = [
  { href: '/dashboard/command', label: 'Overview' },
  { href: '/dashboard/command/academies', label: 'Academies' },
  { href: '/dashboard/command/branches', label: 'Branches' },
  { href: '/dashboard/command/finance', label: 'Finance' },
  { href: '/dashboard/command/academics', label: 'Academics' },
  { href: '/dashboard/command/people', label: 'People' },
  { href: '/dashboard/command/announcements', label: 'Announcements' },
  { href: '/dashboard/command/reporting', label: 'Reporting & reconciliation' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/audit', label: 'Audit log' },
];

export function CommandNav() {
  const pathname = usePathname();
  const active = (href: string) => (href === '/dashboard/command' ? pathname === href : pathname.startsWith(href));
  return (
    <nav aria-label="Command Centre" className="flex gap-5 overflow-x-auto border-b border-line [scrollbar-width:none] print:hidden">
      {SECTIONS.map((s) => (
        <Link key={s.href} href={s.href} aria-current={active(s.href) ? 'page' : undefined}
          className={cx('relative whitespace-nowrap py-2.5 text-sm font-medium transition-colors duration-150', active(s.href) ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand' : 'text-ink-3 hover:text-ink')}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
