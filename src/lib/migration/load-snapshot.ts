/**
 * Strynkix LMS — Migration Snapshot Loader
 * Reads only the ID-level fields the migration planner needs. Names, emails and
 * other personal fields are never copied into the snapshot.
 */

import { collection, getDocs, Firestore } from 'firebase/firestore';
import type { MigrationSnapshot } from './enrollment-migration';

function pick<T extends object>(id: string, data: Record<string, unknown>, fields: string[]): T {
  const out: Record<string, unknown> = { id };
  for (const f of fields) if (data[f] !== undefined) out[f] = data[f];
  return out as T;
}

export async function loadMigrationSnapshot(db: Firestore): Promise<MigrationSnapshot> {
  const read = async (name: string) => (await getDocs(collection(db, name))).docs;
  const [users, branches, courses, batches, enrollments, progress] = await Promise.all(
    ['users', 'branches', 'courses', 'batches', 'enrollments', 'progress'].map(read)
  );
  return {
    users: users.map((d) => pick(d.id, d.data(), ['role', 'orgId', 'branchId', 'status'])),
    branches: branches.map((d) => pick(d.id, d.data(), ['orgId'])),
    courses: courses.map((d) => pick(d.id, d.data(), ['orgId', 'status'])),
    batches: batches.map((d) => pick(d.id, d.data(), ['orgId', 'branchId', 'courseId', 'status'])),
    enrollments: enrollments.map((d) =>
      pick(d.id, d.data(), ['orgId', 'branchId', 'courseId', 'batchId', 'studentId', 'status', 'enrolledAt', 'completedAt'])
    ),
    progress: progress.map((d) => pick(d.id, d.data(), ['orgId', 'studentId', 'courseId', 'batchId'])),
  };
}
