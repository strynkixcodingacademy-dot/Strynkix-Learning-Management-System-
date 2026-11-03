/**
 * Strynkix LMS — trusted academy (organization) and branch maintenance
 * (milestone G35/G50). Edits and status changes are authorized here and
 * written together with an audit entry. Nothing is ever deleted: deactivating
 * uses the existing statuses (academy `suspended`, branch `inactive`), which
 * keep every batch, enrollment, profile and record intact. Deactivated
 * academies and branches get no new accounts (account route) or batches
 * (batch service), and are shown as such in the dashboard.
 * - Academies: Super Admin only.
 * - Branches: Super Admin, or the University Admin of that academy.
 */

import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { idSchema } from '@/types/validation';
import { validateUserProfile } from '@/lib/auth/profile';
import { ReviewError } from '@/lib/review/workflow';
import { verifyCaller } from '@/lib/server/content-route';

const name = z.string().trim().min(2, 'Use a name of at least 2 characters.').max(120);

export const academyRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_org'), orgId: idSchema,
    fields: z.object({
      name: name.optional(),
      website: z.union([z.string().trim().url('Use a full https:// address.').max(300), z.literal('')]).optional(),
      defaultTimezone: z.string().trim().min(1).max(64).optional(),
    }).strict(),
  }).strict(),
  z.object({ action: z.literal('set_org_status'), orgId: idSchema, status: z.enum(['active', 'suspended']), reason: z.string().trim().max(1000).optional() }).strict(),
  z.object({
    action: z.literal('update_branch'), branchId: idSchema,
    fields: z.object({ name: name.optional(), code: z.string().trim().min(1).max(20).optional(), city: z.string().trim().max(80).optional() }).strict(),
  }).strict(),
  z.object({ action: z.literal('set_branch_status'), branchId: idSchema, status: z.enum(['active', 'inactive']), reason: z.string().trim().max(1000).optional() }).strict(),
]);

const denied = () => new ReviewError(403, 'not_allowed', 'You can’t change this academy or branch.');
const notFound = () => new ReviewError(404, 'not_found', 'That academy or branch isn’t available.');

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function changeAcademy(services: { db: Firestore; auth: Auth }, idToken: string | null, body: unknown) {
  const uid = await verifyCaller(services.auth, idToken);
  const parsed = academyRequestSchema.safeParse(body);
  if (!parsed.success) throw new ReviewError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is malformed.');
  const req = parsed.data;
  const { db } = services;

  return db.runTransaction(async (tx) => {
    const actorSnap = await tx.get(db.doc(`users/${uid}`));
    const actor = actorSnap.exists ? validateUserProfile(uid, actorSnap.data()).profile : null;
    if (!actor || actor.status !== 'active') throw denied();
    const iso = new Date().toISOString();
    const audit = (orgId: string, targetType: 'organization' | 'branch', targetId: string, extra: Record<string, unknown>) =>
      tx.create(db.collection('auditLog').doc(), { orgId, courseId: null, targetType, targetId, action: req.action, actorId: uid, actorRole: actor.role, ...extra, at: FieldValue.serverTimestamp() });

    if (req.action === 'update_org' || req.action === 'set_org_status') {
      if (actor.role !== 'super_admin') throw actor.orgId === req.orgId ? denied() : notFound();
      const ref = db.doc(`organizations/${req.orgId}`);
      const org = (await tx.get(ref)).data();
      if (!org) throw notFound();
      if (req.action === 'set_org_status') {
        if ((org.status ?? 'active') === req.status) throw new ReviewError(409, 'invalid_transition', `The academy is already ${req.status}.`);
        if (req.status === 'suspended' && req.orgId === actor.orgId) throw new ReviewError(409, 'invalid_transition', 'You can’t suspend your own academy.');
        tx.update(ref, { status: req.status, updatedAt: iso });
        audit(req.orgId, 'organization', req.orgId, { fromStatus: org.status ?? 'active', toStatus: req.status, ...(req.reason ? { reason: req.reason } : {}) });
        return { ok: true };
      }
      const f = req.fields;
      if (f.defaultTimezone && !validTimeZone(f.defaultTimezone)) throw new ReviewError(400, 'invalid_request', 'Unknown time zone.');
      const update: Record<string, unknown> = {};
      if (f.name !== undefined) update.name = f.name;
      if (f.website !== undefined) update.website = f.website;
      if (f.defaultTimezone !== undefined) update['settings.defaultTimezone'] = f.defaultTimezone;
      if (!Object.keys(update).length) throw new ReviewError(400, 'invalid_request', 'Nothing to change.');
      tx.update(ref, { ...update, updatedAt: iso });
      audit(req.orgId, 'organization', req.orgId, { fields: Object.keys(f).sort() });
      return { ok: true };
    }

    const ref = db.doc(`branches/${req.branchId}`);
    const branch = (await tx.get(ref)).data();
    if (!branch) throw notFound();
    if (actor.role !== 'super_admin') {
      if (actor.orgId !== branch.orgId) throw notFound();
      if (actor.role !== 'university_admin') throw denied();
    }
    if (req.action === 'set_branch_status') {
      if ((branch.status ?? 'active') === req.status) throw new ReviewError(409, 'invalid_transition', `The branch is already ${req.status}.`);
      tx.update(ref, { status: req.status, updatedAt: iso });
      audit(branch.orgId, 'branch', req.branchId, { fromStatus: branch.status ?? 'active', toStatus: req.status, ...(req.reason ? { reason: req.reason } : {}) });
      return { ok: true };
    }
    const f = req.fields;
    const update: Record<string, unknown> = {};
    if (f.name !== undefined) update.name = f.name;
    if (f.code !== undefined) update.code = f.code.toUpperCase();
    if (f.city !== undefined) update['location.city'] = f.city;
    if (!Object.keys(update).length) throw new ReviewError(400, 'invalid_request', 'Nothing to change.');
    tx.update(ref, { ...update, updatedAt: iso });
    audit(branch.orgId, 'branch', req.branchId, { fields: Object.keys(f).sort() });
    return { ok: true };
  });
}
