'use client';

import React from 'react';
import { StatusPill } from '@/components/ui/StatusPill';

const PAY_TONE = { paid: 'success', overdue: 'danger', partial: 'warning', pending: 'neutral', cancelled: 'neutral' } as const;
const PAY_LABEL = { paid: 'Paid', overdue: 'Overdue', partial: 'Partly paid', pending: 'Not paid yet', cancelled: 'Cancelled' } as const;

export function PaymentStatusPill({ status }: { status: keyof typeof PAY_TONE }) {
  return <StatusPill size="sm" tone={PAY_TONE[status]}>{PAY_LABEL[status]}</StatusPill>;
}

const INST_TONE = { paid: 'success', partial: 'warning', overdue: 'danger', due_today: 'coral', upcoming: 'neutral' } as const;
const INST_LABEL = { paid: 'Paid', partial: 'Partly paid', overdue: 'Overdue', due_today: 'Due today', upcoming: 'Upcoming' } as const;
export function InstallmentPill({ state }: { state: keyof typeof INST_TONE }) {
  return <StatusPill size="sm" tone={INST_TONE[state]}>{INST_LABEL[state]}</StatusPill>;
}

/** A client request id, so a retried or double-clicked entry is recorded once. */
export const newRequestId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
