import 'server-only';

/**
 * GET /api/jobs/snapshots — the scheduled reporting job (Stage 9).
 *
 * Intended for Vercel Cron, which calls the path with
 * `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET environment
 * variable is set. Without CRON_SECRET the route refuses to run, so nobody can
 * trigger global jobs. The run is idempotent and locked: a duplicate or
 * overlapping call can't double-count (see src/lib/server/snapshots.ts).
 * Not enabled yet: adding the schedule to vercel.json needs owner approval
 * (docs/STAGING_READINESS.md §25).
 */

import { timingSafeEqual } from 'node:crypto';
import { AdminConfigError, getAdminServices } from '@/lib/server/firebase-admin';
import { runJob } from '@/lib/server/snapshots';
import { runReminders } from '@/lib/server/engagement';

export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!process.env.CRON_SECRET) return Response.json({ error: 'not_configured', message: 'Scheduled jobs are not configured.' }, { status: 503, headers });
  if (!authorized(request.headers.get('authorization'))) return Response.json({ error: 'unauthenticated', message: 'Not allowed.' }, { status: 401, headers });
  try {
    const { db } = getAdminServices();
    const r = await runJob(db, { kind: 'scheduled' }, { trigger: 'cron', actorId: 'system:cron' });
    // Stage 10: due-date, activity and attendance reminders (one per student per item; repeat runs are harmless).
    const reminders = await runReminders(db).catch((e) => { console.error('[jobs/reminders]', e); return null; });
    return Response.json({ jobId: r.jobId, status: r.status, results: r.results, errors: r.errors.length, reminders }, { status: r.status === 'failed' ? 500 : 200, headers });
  } catch (err) {
    console.error('[jobs/snapshots]', err instanceof AdminConfigError ? err.message : err);
    return Response.json({ error: 'unavailable', message: 'The job could not run.' }, { status: 503, headers });
  }
}
