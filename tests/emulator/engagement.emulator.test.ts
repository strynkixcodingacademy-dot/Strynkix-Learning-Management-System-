/**
 * Stage 10 — engagement, achievements, feedback, doubts, activities, project
 * review and reminders through the real routes on the emulators: real data
 * only, single awards and registrations under concurrency, privacy and
 * course/batch/branch/academy boundaries.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as engagement } from '@/app/api/engagement/route';
import { POST as feedback } from '@/app/api/feedback/route';
import { POST as doubts } from '@/app/api/doubts/route';
import { POST as activities } from '@/app/api/activities/route';
import { POST as career } from '@/app/api/career/route';
import { getAdminServices } from '@/lib/server/firebase-admin';
import { localDate } from '@/lib/server/academy-scope';
import { runReminders } from '@/lib/server/engagement';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const USERS = ['eg_sa', 'eg_ua', 'eg_ba1', 'eg_ba2', 'eg_inst', 'eg_inst2', 'eg_instB', 'eg_stu', 'eg_stu2', 'eg_stuB2', 'eg_stuX'];
const NOW = '2026-01-01T00:00:00.000Z';
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);
const isoDaysAgo = (n: number) => daysAgo(n).toISOString();

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();
async function idToken(uid: string) {
  if (tokens.has(uid)) return tokens.get(uid)!;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const t = (await res.json()).idToken;
  tokens.set(uid, t);
  return t;
}
type Handler = (r: Request) => Promise<Response>;
async function call(h: Handler, uid: string, body: unknown) {
  const res = await h(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const E = (u: string, b: unknown) => call(engagement, u, b);
const F = (u: string, b: unknown) => call(feedback, u, b);
const D = (u: string, b: unknown) => call(doubts, u, b);
const A = (u: string, b: unknown) => call(activities, u, b);
const get = async (p: string) => (await db.doc(p).get()).data();
const notes = async (uid: string, type?: string) => (await db.collection('notifications').where('userId', '==', uid).get()).docs.map((d) => d.data()).filter((n) => !type || n.type === type);

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) { await auth.deleteUser(uid).catch(() => undefined); await auth.createUser({ uid, email: `${uid}@eg.test` }); }
});

beforeEach(async () => {
  tokens.clear();
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) => put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@eg.test`, displayName: uid, createdAt: NOW, updatedAt: NOW, ...extra });
  await put('organizations/org_a', { name: 'Alpha', status: 'active' }); await put('organizations/org_b', { name: 'Beta', status: 'active' });
  await put('branches/b1', { orgId: 'org_a', name: 'Pune', status: 'active' }); await put('branches/b2', { orgId: 'org_a', name: 'Mumbai', status: 'active' }); await put('branches/bx', { orgId: 'org_b', name: 'Delhi', status: 'active' });
  await u('eg_sa', 'super_admin'); await u('eg_ua', 'university_admin'); await u('eg_ba1', 'branch_admin', { branchId: 'b1' }); await u('eg_ba2', 'branch_admin', { branchId: 'b2' });
  await u('eg_inst', 'instructor', { branchId: 'b1' }); await u('eg_inst2', 'instructor', { branchId: 'b1' }); await u('eg_instB', 'instructor', { orgId: 'org_b', branchId: 'bx' });
  await u('eg_stu', 'student', { branchId: 'b1' }); await u('eg_stu2', 'student', { branchId: 'b1' }); await u('eg_stuB2', 'student', { branchId: 'b2' }); await u('eg_stuX', 'student', { orgId: 'org_b', branchId: 'bx' });
  await put('courses/c1', { orgId: 'org_a', title: 'Web Dev', status: 'published' });
  await put('lessons/l1', { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: 'HTML', status: 'published' });
  await put('modules/m1', { orgId: 'org_a', courseId: 'c1', title: 'Basics' });
  await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', name: 'Pune A', instructorUserIds: ['eg_inst'], instructorNames: ['eg_inst'], startDate: '2026-01-01', status: 'in_progress' });
  await put('batches/bt2', { orgId: 'org_a', branchId: 'b2', courseId: 'c1', name: 'Mumbai A', instructorUserIds: [], startDate: '2026-01-01', status: 'in_progress' });
  const enroll = (stu: string, batch: string, branch: string) => put(`enrollments/c1_${stu}`, { orgId: 'org_a', branchId: branch, courseId: 'c1', batchId: batch, studentId: stu, studentDisplayName: stu, status: 'active', enrolledAt: NOW });
  await enroll('eg_stu', 'bt1', 'b1'); await enroll('eg_stu2', 'bt1', 'b1'); await enroll('eg_stuB2', 'bt2', 'b2');
});

describe('engagement and achievements', () => {
  it('streaks come only from recorded learning; viewing the dashboard adds nothing', async () => {
    let r = await E('eg_stu', { action: 'my_engagement' });
    expect(r.json.streak).toMatchObject({ current: 0, totalDays: 0 });
    r = await E('eg_stu', { action: 'my_engagement' });
    expect(r.json.streak.totalDays).toBe(0);
    for (const n of [0, 1, 2]) await db.doc(`progress/eg_stu_l${n}`).set({ orgId: 'org_a', courseId: 'c1', lessonId: `l${n}`, studentId: 'eg_stu', batchId: 'bt1', status: 'completed', completedAt: isoDaysAgo(n), updatedAt: isoDaysAgo(n) });
    await db.doc('attendance/bt1_x').set({ orgId: 'org_a', branchId: 'b1', batchId: 'bt1', date: localDate(daysAgo(5)), records: { eg_stu: 'present' } });
    r = await E('eg_stu', { action: 'my_engagement' });
    expect(r.json.streak).toMatchObject({ current: 3, longest: 3, totalDays: 4, learnedToday: true });
    expect(r.json.stats).toMatchObject({ lessonsCompleted: 3 });
    expect(r.json.newlyAwarded).toEqual(['first_lesson']);
    expect((await E('eg_inst', { action: 'my_engagement' })).status).toBe(403);
  });

  it('achievements are awarded once even under concurrent requests; muted achievements send no notification', async () => {
    await db.doc('progress/eg_stu_l1').set({ orgId: 'org_a', courseId: 'c1', lessonId: 'l1', studentId: 'eg_stu', status: 'completed', completedAt: isoDaysAgo(1) });
    await Promise.all([E('eg_stu', { action: 'my_engagement' }), E('eg_stu', { action: 'my_engagement' }), E('eg_stu', { action: 'my_engagement' })]);
    expect((await db.collection('achievements').where('studentId', '==', 'eg_stu').get()).size).toBe(1);
    expect(await notes('eg_stu', 'achievement_awarded')).toHaveLength(1);
    await E('eg_stu2', { action: 'set_preferences', muted: ['achievements'] });
    await db.doc('progress/eg_stu2_l1').set({ orgId: 'org_a', courseId: 'c1', lessonId: 'l1', studentId: 'eg_stu2', status: 'completed', completedAt: isoDaysAgo(1) });
    await E('eg_stu2', { action: 'my_engagement' });
    expect(await get('achievements/eg_stu2_first_lesson')).toBeTruthy();
    expect(await notes('eg_stu2', 'achievement_awarded')).toHaveLength(0);
  });

  it('achievement settings: academy administrators only; fixed thresholds can’t change', async () => {
    expect((await E('eg_ba1', { action: 'save_achievement_settings', disabled: [], thresholds: {} })).status).toBe(403);
    expect((await E('eg_ua', { action: 'save_achievement_settings', disabled: [], thresholds: { first_lesson: 5 } })).status).toBe(400);
    expect((await E('eg_ua', { action: 'save_achievement_settings', disabled: ['first_lesson'], thresholds: { lessons_10: 20 } })).status).toBe(200);
    await db.doc('progress/eg_stu_l1').set({ orgId: 'org_a', courseId: 'c1', lessonId: 'l1', studentId: 'eg_stu', status: 'completed', completedAt: isoDaysAgo(1) });
    expect((await E('eg_stu', { action: 'my_engagement' })).json.newlyAwarded).toEqual([]);
  });
});

describe('feedback', () => {
  it('eligibility, one response with limited corrections, and locking after staff respond', async () => {
    expect((await F('eg_stuX', { action: 'submit', targetType: 'course', targetId: 'c1', rating: 5 })).status).toBe(400);
    expect((await F('eg_stu', { action: 'submit', targetType: 'facilities', targetId: 'b2', rating: 5 })).status).toBe(400);
    expect((await F('eg_stu', { action: 'submit', targetType: 'course', targetId: 'c1' })).status).toBe(400); // rating required
    const s1 = await F('eg_stu', { action: 'submit', targetType: 'teaching', targetId: 'bt1', rating: 4, comment: 'Great examples', tags: ['Helpful examples'], anonymous: true });
    expect(s1.json).toMatchObject({ corrected: false });
    const s2 = await F('eg_stu', { action: 'submit', targetType: 'teaching', targetId: 'bt1', rating: 5, comment: 'Great examples!', tags: ['Helpful examples'], anonymous: true });
    expect(s2.json).toMatchObject({ corrected: true, editsLeft: 2 });
    expect((await db.collection(`feedback/${s1.json.feedbackId}/history`).get()).size).toBe(1);
    expect((await F('eg_inst', { action: 'set_status', feedbackId: s1.json.feedbackId, status: 'acknowledged' })).status).toBe(403);
    expect((await F('eg_ba1', { action: 'set_status', feedbackId: s1.json.feedbackId, status: 'acknowledged', note: 'Thanks' })).status).toBe(200);
    expect((await F('eg_stu', { action: 'submit', targetType: 'teaching', targetId: 'bt1', rating: 1 })).json.error).toBe('locked');
    expect(await notes('eg_stu', 'feedback_update')).toHaveLength(1);
  });

  it('privacy: hidden names stay hidden, averages need 3 responses, and scope is enforced', async () => {
    await F('eg_stu', { action: 'submit', targetType: 'teaching', targetId: 'bt1', rating: 5, comment: 'Clear', anonymous: true });
    await F('eg_stu2', { action: 'submit', targetType: 'teaching', targetId: 'bt1', rating: 3, comment: 'A bit fast', tags: ['Too fast'] });
    await F('eg_stuB2', { action: 'submit', targetType: 'facilities', targetId: 'b2', rating: 2, comment: 'AC broken' });
    const inst = await F('eg_inst', { action: 'summary' });
    expect(inst.json.targets).toEqual([expect.objectContaining({ targetType: 'teaching', responses: 2, rating: expect.objectContaining({ average: null }), improve: [{ tag: 'Too fast', count: 1 }] })]);
    const byComment = Object.fromEntries(inst.json.comments.map((c: { comment: string; student: unknown }) => [c.comment, c.student]));
    expect(byComment).toEqual({ Clear: null, 'A bit fast': { id: 'eg_stu2', name: 'eg_stu2' } });
    expect(JSON.stringify(inst.json)).not.toContain('eg_stu"'); // the hidden student's id never appears
    expect((await F('eg_inst2', { action: 'summary' })).json.total).toBe(0); // not their batch
    expect((await F('eg_ba1', { action: 'summary' })).json.comments.map((c: { comment: string }) => c.comment).sort()).toEqual(['A bit fast', 'Clear']);
    expect((await F('eg_ba1', { action: 'summary', branchId: 'b2' })).status).toBe(404);
    expect((await F('eg_ua', { action: 'summary' })).json.total).toBe(3);
    expect((await F('eg_instB', { action: 'summary' })).json.total).toBe(0);
    expect((await F('eg_stu', { action: 'summary' })).status).toBe(403);
  });
});

describe('doubts', () => {
  it('only the student, their batch’s instructors and managers see it; history and notifications are kept', async () => {
    expect((await D('eg_stuX', { action: 'create', courseId: 'c1', title: 'How do flexbox gaps work?', body: 'I don’t understand gap vs margin.' })).status).toBe(400);
    const c = await D('eg_stu', { action: 'create', courseId: 'c1', lessonId: 'l1', title: 'How do flexbox gaps work?', body: 'I don’t understand gap vs margin.' });
    const id = c.json.doubtId;
    expect(await get(`doubts/${id}`)).toMatchObject({ batchId: 'bt1', branchId: 'b1', status: 'open', lessonTitle: 'HTML' });
    expect(await notes('eg_inst', 'doubt_reply')).toHaveLength(1);
    for (const u of ['eg_stu2', 'eg_inst2', 'eg_ba2', 'eg_instB']) expect((await D(u, { action: 'get', doubtId: id })).status).toBe(404);
    expect((await D('eg_inst2', { action: 'list' })).json.doubts).toEqual([]);
    expect((await D('eg_stu2', { action: 'list' })).json.doubts).toEqual([]);
    expect((await D('eg_inst', { action: 'reply', doubtId: id, body: 'gap adds space between items only.' })).json.status).toBe('in_progress');
    expect((await get(`doubts/${id}`))!.firstResponseAt).toBeTruthy();
    expect(await notes('eg_stu', 'doubt_reply')).toHaveLength(1);
    expect((await D('eg_stu', { action: 'set_status', doubtId: id, status: 'waiting_for_student' })).status).toBe(403);
    expect((await D('eg_inst', { action: 'assign', doubtId: id, instructorId: 'eg_inst2' })).status).toBe(400);
    expect((await D('eg_inst', { action: 'set_status', doubtId: id, status: 'waiting_for_student', note: 'Can you share your CSS?' })).status).toBe(200);
    expect((await D('eg_stu', { action: 'reply', doubtId: id, body: 'Here it is.' })).json.status).toBe('open');
    expect((await D('eg_stu', { action: 'set_status', doubtId: id, status: 'resolved' })).status).toBe(200);
    expect((await D('eg_stu', { action: 'reply', doubtId: id, body: 'One more thing' })).status).toBe(409);
    expect((await D('eg_stu', { action: 'set_status', doubtId: id, status: 'reopen' })).json.status).toBe('open');
    const full = await D('eg_ba1', { action: 'get', doubtId: id });
    expect(full.json.messages.map((m: { kind: string; toStatus?: string }) => m.toStatus ?? m.kind)).toEqual(['message', 'waiting_for_student', 'message', 'resolved', 'open']);
  });
});

describe('activities', () => {
  const activity = (extra: Record<string, unknown> = {}) => ({
    branchId: 'b1', type: 'workshop', title: 'React workshop', description: '', startsAt: new Date(Date.now() + 3 * 86400_000).toISOString(), endsAt: new Date(Date.now() + 3 * 86400_000 + 7200_000).toISOString(),
    registrationDeadline: new Date(Date.now() + 2 * 86400_000).toISOString(), capacity: 2, organizerName: 'eg_inst', location: 'Lab 1', mode: 'in_person', ...extra,
  });
  it('scope for creating; eligibility; capacity holds under concurrent registration', async () => {
    expect((await A('eg_ba2', { action: 'save', activity: activity() })).status).toBe(403);
    expect((await A('eg_ba1', { action: 'save', activity: activity({ branchId: null }) })).status).toBe(403);
    const id = (await A('eg_ba1', { action: 'save', activity: activity() })).json.activityId;
    await db.doc('users/eg_stu3').set({ role: 'student', orgId: 'org_a', branchId: 'b1', status: 'active', email: 'eg_stu3@eg.test', displayName: 'eg_stu3' });
    await auth.deleteUser('eg_stu3').catch(() => undefined); await auth.createUser({ uid: 'eg_stu3', email: 'eg_stu3@eg.test' });
    const results = await Promise.all(['eg_stu', 'eg_stu2', 'eg_stu3'].map((u) => A(u, { action: 'register', activityId: id })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.json.error === 'full')).toHaveLength(1);
    expect((await get(`activities/${id}`))!.registeredCount).toBe(2);
    const winner = ['eg_stu', 'eg_stu2', 'eg_stu3'][results.findIndex((r) => r.status === 200)];
    expect((await A(winner, { action: 'register', activityId: id })).json.error).toBe('duplicate');
    expect((await A(winner, { action: 'cancel_registration', activityId: id })).json.status).toBe('cancelled');
    expect((await get(`activities/${id}`))!.registeredCount).toBe(1);
    expect((await A('eg_stuB2', { action: 'register', activityId: id })).status).toBe(404); // other branch
    expect((await A('eg_stuX', { action: 'register', activityId: id })).status).toBe(404); // other academy
    expect((await A('eg_ba1', { action: 'set_status', activityId: id, status: 'cancelled', reason: 'Trainer unwell' })).json.notified).toBe(1);
  });
});

describe('projects', () => {
  it('only the batch’s instructor approves; "verified" only after approval; edits send it back to draft', async () => {
    const e = await call(career, 'eg_stu', { action: 'save_entry', entry: { title: 'Todo app', description: 'A React todo application.', technologies: ['React'] } });
    const id = e.json.entryId;
    expect((await call(career, 'eg_stu', { action: 'submit_project', entryId: id, courseId: 'c1' })).status).toBe(400); // needs a link
    await call(career, 'eg_stu', { action: 'save_entry', entryId: id, entry: { title: 'Todo app', description: 'A React todo application.', technologies: ['React'], repoUrl: 'https://github.com/x/todo' } });
    expect((await call(career, 'eg_stu', { action: 'submit_project', entryId: id, courseId: 'c1' })).json.status).toBe('submitted');
    expect((await call(career, 'eg_inst2', { action: 'review_project', entryId: id, decision: 'approve' })).status).toBe(403);
    expect((await call(career, 'eg_ba2', { action: 'review_project', entryId: id, decision: 'approve' })).status).toBe(403);
    expect((await call(career, 'eg_inst', { action: 'project_queue' })).json.projects.map((p: { id: string }) => p.id)).toEqual([id]);
    expect((await call(career, 'eg_inst', { action: 'review_project', entryId: id, decision: 'changes' })).status).toBe(400);
    expect((await call(career, 'eg_inst', { action: 'review_project', entryId: id, decision: 'approve', comment: 'Well structured.' })).json.status).toBe('approved');
    expect(await get(`portfolioEntries/${id}`)).toMatchObject({ reviewStatus: 'approved', verified: true, verifiedById: 'eg_inst' });
    expect((await E('eg_stu', { action: 'my_engagement' })).json.newlyAwarded).toContain('first_project');
    await call(career, 'eg_stu', { action: 'save_entry', entryId: id, entry: { title: 'Todo app v2', description: 'A React todo application.', technologies: ['React'], repoUrl: 'https://github.com/x/todo' } });
    expect(await get(`portfolioEntries/${id}`)).toMatchObject({ reviewStatus: 'draft', verified: false });
    expect((await call(career, 'eg_stu', { action: 'project_reviews', entryId: id })).json.reviews.map((r: { toStatus: string }) => r.toStatus)).toEqual(['submitted', 'approved', 'draft']);
  });
});

describe('reminders and engagement views', () => {
  it('reminds once per student per item and honours muted reminders', async () => {
    await db.doc('assessments/as1').set({ orgId: 'org_a', courseId: 'c1', title: 'Quiz 1', status: 'published', kind: 'quiz', closesAt: new Date(Date.now() + 24 * 3600_000).toISOString() });
    await E('eg_stu2', { action: 'set_preferences', muted: ['reminders'] });
    const first = await runReminders(db);
    const second = await runReminders(db);
    expect(await notes('eg_stu', 'assessment_reminder')).toHaveLength(1);
    expect(await notes('eg_stu2', 'assessment_reminder')).toHaveLength(0);
    expect(first.sent).toBeGreaterThanOrEqual(2); // eg_stu and eg_stuB2
    expect(second.sent).toBe(0);
    expect((await E('eg_ua', { action: 'run_reminders' })).status).toBe(403);
  });

  it('instructor and academy engagement views stay within scope', async () => {
    expect((await E('eg_inst', { action: 'instructor_dashboard' })).json).toMatchObject({ students: 2, batches: [expect.objectContaining({ id: 'bt1', students: 2 })] });
    expect((await E('eg_ba1', { action: 'instructor_dashboard' })).status).toBe(403);
    expect((await E('eg_ba1', { action: 'academy_engagement' })).json).toMatchObject({ students: 2 });
    expect((await E('eg_ba1', { action: 'academy_engagement', branchId: 'b2' })).status).toBe(404);
    expect((await E('eg_ua', { action: 'academy_engagement' })).json.students).toBe(3);
    expect((await E('eg_ua', { action: 'academy_engagement', orgId: 'org_b' })).status).toBe(404);
    expect((await E('eg_inst', { action: 'academy_engagement' })).status).toBe(403);
    expect((await E('eg_stu', { action: 'academy_engagement' })).status).toBe(403);
  });
});
