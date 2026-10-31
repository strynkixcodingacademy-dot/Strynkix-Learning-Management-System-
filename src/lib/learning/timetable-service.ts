/**
 * Strynkix LMS — Weekly Timetable Service
 * Operations for creating, editing, submitting, reviewing, approving and activating
 * weekly timetables and revisions. Atomic transactions guarantee that approvals
 * and active-version updates are strictly consistent and audited.
 */

import {
  collection,
  doc,
  DocumentData,
  Firestore,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { TenantContext } from '@/types/auth';
import {
  Batch,
  DayOfWeek,
  DaySchedule,
  TimetableAuditAction,
  TimetableAuditLog,
  TimetableRevision,
  WeeklyTimetable,
} from '@/types/domain';
import {
  timetableApprovalSchema,
  timetableCorrectionSchema,
  timetableRevisionSchema,
  weeklyTimetableSchema,
} from '@/types/validation';
import { canManageBatchScope, isBatchOpenForEnrollment } from '@/lib/batches/scope';
import {
  createEmptyDaysRecord,
  getSundayOfWeek,
  normalizeActivityOrder,
  revisionIdFor,
  timetableIdFor,
} from './timetable';

function formatZodError(error: { issues: { message: string }[] }): string {
  return error.issues.map((i) => i.message).join('; ');
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}

export function normalizeAuditLog(id: string, data: DocumentData): TimetableAuditLog {
  return {
    ...(data as TimetableAuditLog),
    id,
    timestamp: toIso(data.timestamp) ?? new Date().toISOString(),
  };
}

export function canManageTimetable(tenant: TenantContext | null, batch: Batch): boolean {
  if (!tenant) return false;
  return canManageBatchScope(tenant, batch);
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export async function getWeeklyTimetable(
  timetableId: string,
  fs: Firestore = db
): Promise<WeeklyTimetable | null> {
  const snap = await getDoc(doc(fs, 'timetables', timetableId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WeeklyTimetable) : null;
}

export async function getTimetableRevision(
  timetableId: string,
  revisionId: string,
  fs: Firestore = db
): Promise<TimetableRevision | null> {
  const snap = await getDoc(doc(fs, `timetables/${timetableId}/revisions`, revisionId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as TimetableRevision) : null;
}

export async function getActiveTimetableForBatch(
  batchId: string,
  weekStartDate: string,
  fs: Firestore = db
): Promise<{ timetable: WeeklyTimetable; activeRevision: TimetableRevision } | null> {
  const timetableId = timetableIdFor(batchId, weekStartDate);
  const timetable = await getWeeklyTimetable(timetableId, fs);
  if (!timetable || !timetable.activeRevisionId) return null;

  const activeRevision = await getTimetableRevision(timetableId, timetable.activeRevisionId, fs);
  if (!activeRevision || activeRevision.status !== 'approved') return null;

  return { timetable, activeRevision };
}

export async function getBatchTimetables(
  batch: Batch,
  fs: Firestore = db
): Promise<WeeklyTimetable[]> {
  const snap = await getDocs(
    query(
      collection(fs, 'timetables'),
      where('orgId', '==', batch.orgId),
      where('batchId', '==', batch.id),
      orderBy('weekStartDate', 'desc'),
      limit(52)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WeeklyTimetable));
}

export async function getPendingTimetables(
  orgId: string,
  fs: Firestore = db
): Promise<WeeklyTimetable[]> {
  const snap = await getDocs(
    query(
      collection(fs, 'timetables'),
      where('orgId', '==', orgId),
      where('latestStatus', '==', 'submitted'),
      orderBy('weekStartDate', 'desc'),
      limit(50)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WeeklyTimetable));
}

export async function getTimetableAuditLogs(
  timetableId: string,
  fs: Firestore = db
): Promise<TimetableAuditLog[]> {
  const snap = await getDocs(
    query(
      collection(fs, `timetables/${timetableId}/auditLogs`),
      orderBy('timestamp', 'desc'),
      limit(50)
    )
  );
  return snap.docs.map((d) => normalizeAuditLog(d.id, d.data()));
}

// -----------------------------------------------------------------------------
// Writes: Branch Manager Draft Creation & Editing
// -----------------------------------------------------------------------------

export async function saveTimetableDraft(
  batch: Batch,
  weekStartDate: string,
  daysInput: Record<DayOfWeek, DaySchedule>,
  tenant: TenantContext | null,
  uid: string,
  existingRevisionId?: string,
  fs: Firestore = db
): Promise<{ timetable: WeeklyTimetable; revision: TimetableRevision }> {
  if (!canManageTimetable(tenant, batch)) {
    throw new Error('You are not authorized to manage timetables for this batch.');
  }
  if (!isBatchOpenForEnrollment(batch.status)) {
    throw new Error(`This batch is ${batch.status.replace('_', ' ')}; timetables are read-only.`);
  }

  const timetableId = timetableIdFor(batch.id, weekStartDate);
  const weekEndDate = getSundayOfWeek(weekStartDate);
  const now = new Date().toISOString();

  // Normalize activity ordering within each day
  const normalizedDays: Record<DayOfWeek, DaySchedule> = { ...daysInput };
  for (const dayKey of Object.keys(normalizedDays) as DayOfWeek[]) {
    normalizedDays[dayKey] = {
      ...normalizedDays[dayKey],
      activities: normalizeActivityOrder(normalizedDays[dayKey].activities),
    };
  }

  // Load existing root if present
  const existingRoot = await getWeeklyTimetable(timetableId, fs);

  let revId: string;
  let revNumber = 1;

  if (existingRevisionId) {
    revId = existingRevisionId;
    const existingRev = await getTimetableRevision(timetableId, revId, fs);
    if (!existingRev) throw new Error('Target revision does not exist.');
    if (existingRev.status === 'approved') {
      throw new Error('Approved timetable revisions are immutable. Create a new revision to make changes.');
    }
    revNumber = existingRev.revisionNumber;
  } else if (existingRoot) {
    // If root exists but no specific revision given, check if current is draft/changes_requested
    const currentRev = await getTimetableRevision(timetableId, existingRoot.currentRevisionId, fs);
    if (currentRev && currentRev.status !== 'approved') {
      revId = currentRev.id;
      revNumber = currentRev.revisionNumber;
    } else {
      // Spawn new revision number
      revNumber = (currentRev?.revisionNumber ?? 1) + 1;
      revId = revisionIdFor(revNumber);
    }
  } else {
    revId = revisionIdFor(1);
    revNumber = 1;
  }

  const parsedRev = timetableRevisionSchema.safeParse({
    id: revId,
    timetableId,
    revisionNumber: revNumber,
    orgId: batch.orgId,
    branchId: batch.branchId,
    batchId: batch.id,
    courseId: batch.courseId,
    weekStartDate,
    weekEndDate,
    status: 'draft',
    days: normalizedDays,
    createdById: uid,
  });
  if (!parsedRev.success) {
    throw new Error(`Invalid timetable revision: ${formatZodError(parsedRev.error)}`);
  }

  const revisionData: TimetableRevision = {
    ...parsedRev.data,
    createdAt: now,
    updatedAt: now,
  };

  const parsedRoot = weeklyTimetableSchema.safeParse({
    id: timetableId,
    orgId: batch.orgId,
    branchId: batch.branchId,
    batchId: batch.id,
    courseId: batch.courseId,
    weekStartDate,
    weekEndDate,
    activeRevisionId: existingRoot?.activeRevisionId ?? null,
    currentRevisionId: revId,
    latestStatus: 'draft',
  });
  if (!parsedRoot.success) {
    throw new Error(`Invalid timetable root: ${formatZodError(parsedRoot.error)}`);
  }

  const rootData: WeeklyTimetable = {
    ...parsedRoot.data,
    createdAt: existingRoot?.createdAt ?? now,
    updatedAt: now,
  };

  // Write root and revision
  await setDoc(doc(fs, 'timetables', timetableId), withoutUndefined(rootData));
  await setDoc(doc(fs, `timetables/${timetableId}/revisions`, revId), withoutUndefined(revisionData));

  // Log creation if first time
  if (!existingRevisionId && revNumber === 1 && !existingRoot) {
    const logRef = doc(collection(fs, `timetables/${timetableId}/auditLogs`));
    await setDoc(logRef, {
      id: logRef.id,
      timetableId,
      revisionId: revId,
      fromStatus: 'draft',
      toStatus: 'draft',
      action: 'create_draft' as TimetableAuditAction,
      actorUid: uid,
      actorRole: tenant?.role ?? 'branch_admin',
      timestamp: serverTimestamp(),
    });
  }

  return { timetable: rootData, revision: revisionData };
}

// -----------------------------------------------------------------------------
// Submission for Approval
// -----------------------------------------------------------------------------

export async function submitTimetableForApproval(
  timetableId: string,
  revisionId: string,
  tenant: TenantContext | null,
  uid: string,
  fs: Firestore = db
): Promise<void> {
  const timetable = await getWeeklyTimetable(timetableId, fs);
  if (!timetable) throw new Error('Timetable not found.');

  const revision = await getTimetableRevision(timetableId, revisionId, fs);
  if (!revision) throw new Error('Revision not found.');
  if (revision.status === 'approved') throw new Error('This revision is already approved.');

  const now = new Date().toISOString();
  const nextStatus = 'submitted';

  // Update revision and root
  await updateDoc(doc(fs, `timetables/${timetableId}/revisions`, revisionId), {
    status: nextStatus,
    submittedById: uid,
    submittedAt: now,
    updatedAt: now,
  });

  await updateDoc(doc(fs, 'timetables', timetableId), {
    currentRevisionId: revisionId,
    latestStatus: nextStatus,
    updatedAt: now,
  });

  // Append audit log
  const logRef = doc(collection(fs, `timetables/${timetableId}/auditLogs`));
  await setDoc(logRef, {
    id: logRef.id,
    timetableId,
    revisionId,
    fromStatus: revision.status,
    toStatus: nextStatus,
    action: revision.status === 'changes_requested' ? 'resubmit' : ('submit' as TimetableAuditAction),
    actorUid: uid,
    actorRole: tenant?.role ?? 'branch_admin',
    timestamp: serverTimestamp(),
  });
}

// -----------------------------------------------------------------------------
// Super Admin Review & Approval (Atomic Transactions)
// -----------------------------------------------------------------------------

export async function requestTimetableChanges(
  timetableId: string,
  revisionId: string,
  comment: string,
  superAdminUid: string,
  fs: Firestore = db
): Promise<void> {
  const parsed = timetableCorrectionSchema.safeParse({ comment });
  if (!parsed.success) {
    throw new Error(`Correction request invalid: ${formatZodError(parsed.error)}`);
  }

  await runTransaction(fs, async (transaction) => {
    const timetableRef = doc(fs, 'timetables', timetableId);
    const revisionRef = doc(fs, `timetables/${timetableId}/revisions`, revisionId);

    const timetableSnap = await transaction.get(timetableRef);
    const revisionSnap = await transaction.get(revisionRef);

    if (!timetableSnap.exists() || !revisionSnap.exists()) {
      throw new Error('Timetable or revision document not found.');
    }

    const revision = revisionSnap.data() as TimetableRevision;
    if (revision.status !== 'submitted') {
      throw new Error(`Cannot request changes on a revision in ${revision.status} status.`);
    }

    const now = new Date().toISOString();
    const nextStatus = 'changes_requested';

    transaction.update(revisionRef, {
      status: nextStatus,
      reviewedById: superAdminUid,
      reviewedAt: now,
      reviewComment: parsed.data.comment,
      updatedAt: now,
    });

    transaction.update(timetableRef, {
      latestStatus: nextStatus,
      updatedAt: now,
    });

    const logRef = doc(collection(fs, `timetables/${timetableId}/auditLogs`));
    transaction.set(logRef, {
      id: logRef.id,
      timetableId,
      revisionId,
      fromStatus: revision.status,
      toStatus: nextStatus,
      action: 'request_changes' as TimetableAuditAction,
      actorUid: superAdminUid,
      actorRole: 'super_admin',
      comment: parsed.data.comment,
      timestamp: serverTimestamp(),
    });
  });
}

export async function approveTimetable(
  timetableId: string,
  revisionId: string,
  superAdminUid: string,
  comment?: string,
  fs: Firestore = db
): Promise<void> {
  const parsed = timetableApprovalSchema.safeParse({ comment });
  if (!parsed.success) {
    throw new Error(`Approval invalid: ${formatZodError(parsed.error)}`);
  }

  await runTransaction(fs, async (transaction) => {
    const timetableRef = doc(fs, 'timetables', timetableId);
    const revisionRef = doc(fs, `timetables/${timetableId}/revisions`, revisionId);

    const timetableSnap = await transaction.get(timetableRef);
    const revisionSnap = await transaction.get(revisionRef);

    if (!timetableSnap.exists() || !revisionSnap.exists()) {
      throw new Error('Timetable or revision document not found.');
    }

    const revision = revisionSnap.data() as TimetableRevision;
    if (revision.status !== 'submitted') {
      throw new Error(`Only submitted revisions can be approved (currently in ${revision.status}).`);
    }

    const now = new Date().toISOString();
    const nextStatus = 'approved';

    // Lock revision as approved
    transaction.update(revisionRef, {
      status: nextStatus,
      reviewedById: superAdminUid,
      reviewedAt: now,
      updatedAt: now,
    });

    // Atomically point activeRevisionId to this approved revision
    transaction.update(timetableRef, {
      activeRevisionId: revisionId,
      latestStatus: nextStatus,
      updatedAt: now,
    });

    const logRef = doc(collection(fs, `timetables/${timetableId}/auditLogs`));
    transaction.set(logRef, {
      id: logRef.id,
      timetableId,
      revisionId,
      fromStatus: revision.status,
      toStatus: nextStatus,
      action: 'approve' as TimetableAuditAction,
      actorUid: superAdminUid,
      actorRole: 'super_admin',
      comment: parsed.data.comment || undefined,
      timestamp: serverTimestamp(),
    });
  });
}

