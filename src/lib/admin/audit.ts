/**
 * Strynkix LMS — read-only access to the academy audit log (milestone G44).
 * Entries are written only by trusted server routes; this reads them a page
 * at a time, newest first, optionally limited to one category. Rules allow
 * the Super Admin and the academy's University Admin to list them.
 */

import { collection, getDocs, limit, orderBy, query, startAfter, where, type DocumentSnapshot, type Firestore } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

export type AuditCategory = 'all' | 'accounts' | 'membership' | 'review' | 'content' | 'academy';

export const AUDIT_CATEGORIES: Record<Exclude<AuditCategory, 'all'>, { label: string; actions: string[] }> = {
  accounts: { label: 'Accounts', actions: ['account_create', 'account_approve', 'account_suspend', 'account_reactivate', 'account_role_change', 'account_branch_move', 'account_email_change'] },
  membership: { label: 'Course Design', actions: ['membership_assign', 'membership_update', 'membership_revoke'] },
  review: { label: 'Review & publishing', actions: ['submit', 'reopen', 'approve', 'request_changes', 'publish', 'unpublish', 'archive'] },
  content: { label: 'Content & assessments', actions: ['update_course', 'update_module', 'reorder_module', 'delete_module', 'reorder_lesson', 'move_lesson', 'delete_lesson', 'lesson_content_update', 'assessment_update', 'assessment_migration'] },
  academy: { label: 'Academy & branches', actions: ['update_org', 'set_org_status', 'update_branch', 'set_branch_status'] },
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  account_create: 'Account created', account_approve: 'Account approved', account_suspend: 'Account suspended', account_reactivate: 'Account reactivated',
  account_role_change: 'Role changed', account_branch_move: 'Moved to another branch', account_email_change: 'Sign-in email corrected',
  membership_assign: 'Course Design membership granted', membership_update: 'Course Design membership changed', membership_revoke: 'Course Design membership revoked',
  submit: 'Submitted for review', reopen: 'Reopened for editing', approve: 'Approved', request_changes: 'Changes requested', publish: 'Published', unpublish: 'Unpublished', archive: 'Archived',
  update_course: 'Course details edited', update_module: 'Module edited', reorder_module: 'Module reordered', delete_module: 'Module deleted',
  reorder_lesson: 'Lesson reordered', move_lesson: 'Lesson moved', delete_lesson: 'Draft lesson deleted', lesson_content_update: 'Lesson content and answers saved',
  assessment_update: 'Assessment edited', assessment_migration: 'Legacy quiz migrated',
  update_org: 'Academy edited', set_org_status: 'Academy status changed', update_branch: 'Branch edited', set_branch_status: 'Branch status changed',
};

export interface AuditRow {
  id: string;
  action: string;
  actorId: string;
  actorRole?: string;
  targetType?: string;
  targetId?: string;
  courseId?: string | null;
  at: Date | null;
  data: Record<string, unknown>;
}

export interface AuditPage { rows: AuditRow[]; cursor: DocumentSnapshot | null; hasMore: boolean }

export const AUDIT_PAGE_SIZE = 25;

export async function getAuditPage(orgId: string, category: AuditCategory, after: DocumentSnapshot | null, fs: Firestore = db, pageSize = AUDIT_PAGE_SIZE): Promise<AuditPage> {
  const constraints = [
    where('orgId', '==', orgId),
    ...(category === 'all' ? [] : [where('action', 'in', AUDIT_CATEGORIES[category].actions)]),
    orderBy('at', 'desc'),
    ...(after ? [startAfter(after)] : []),
    limit(pageSize + 1),
  ];
  const snap = await getDocs(query(collection(fs, 'auditLog'), ...constraints));
  const docs = snap.docs.slice(0, pageSize);
  return {
    rows: docs.map((d) => {
      const data = d.data();
      const at = data.at as { toDate?: () => Date } | undefined;
      return { id: d.id, action: data.action, actorId: data.actorId, actorRole: data.actorRole, targetType: data.targetType, targetId: data.targetId, courseId: data.courseId, at: at?.toDate ? at.toDate() : null, data };
    }),
    cursor: docs.length ? docs[docs.length - 1] : null,
    hasMore: snap.docs.length > pageSize,
  };
}
