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
    <nav aria-label="Command Centre" className="-mx-1 flex gap-1 overflow-x-auto pb-1 print:hidden">
      {SECTIONS.map((s) => (
        <Link key={s.href} href={s.href} aria-current={active(s.href) ? 'page' : undefined}
          className={cx('whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold', active(s.href) ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-2 hover:bg-surface-muted')}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
