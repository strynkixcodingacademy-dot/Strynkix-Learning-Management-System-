/**
 * Academy operations, Batches 1–2 — lesson activities and examinations,
 * evaluation, attendance, certificates and the student's own records, through
 * the real route handlers on the Auth + Firestore emulators with real ID tokens.
 */

import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { POST as assessments } from '@/app/api/assessments/route';
import { POST as attendance } from '@/app/api/attendance/route';
import { POST as certificates } from '@/app/api/certificates/route';
import { GET as verify } from '@/app/api/certificates/verify/route';
import { POST as student } from '@/app/api/student/route';
import { getAdminServices } from '@/lib/server/firebase-admin';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-strynkix-lms';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const NOW = '2026-10-01T00:00:00.000Z';
const USERS = ['al_sa', 'al_ua', 'al_ba1', 'al_ba2', 'al_inst', 'al_inst2', 'al_stu', 'al_stu2', 'al_stuB', 'al_stuX', 'al_des'];

let db: Firestore;
let auth: Auth;
const tokens = new Map<string, string>();

async function idToken(uid: string): Promise<string> {
  if (tokens.has(uid)) return tokens.get(uid)!;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const t = (await res.json()).idToken;
  tokens.set(uid, t);
  return t;
}
type Handler = (r: Request) => Promise<Response>;
async function call(handler: Handler, uid: string, body: unknown) {
  const res = await handler(new Request('http://localhost/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(uid)}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const A = (uid: string, body: unknown) => call(assessments, uid, body);
const get = async (p: string) => (await db.doc(p).get()).data();
const audits = async (action: string) => (await db.collection('auditLog').where('action', '==', action).get()).docs.map((d) => d.data());

const mcq = (id: string, correct: string[], marks = 2, type: 'mcq_single' | 'mcq_multi' = 'mcq_single', negativeMarks?: number) => ({
  id, type, prompt: `Question ${id}?`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], marks, correctOptionIds: correct, ...(negativeMarks ? { negativeMarks } : {}),
});
const quiz = (extra: Record<string, unknown> = {}) => ({
  courseId: 'c1', lessonId: 'l1', moduleId: 'm1', kind: 'quiz', title: 'Lesson 1 quiz', passingPercent: 50, maxAttempts: 2,
  resultRelease: 'immediate', negativeMarking: true, questions: [mcq('q1', ['b'], 2, 'mcq_single', 1), mcq('q2', ['a', 'c'], 2, 'mcq_multi')], ...extra,
});

async function createPublished(uid: string, assessment: Record<string, unknown>): Promise<string> {
  const saved = await A(uid, { action: 'save', assessment });
  expect(saved.status).toBe(200);
  expect((await A(uid, { action: 'set_status', assessmentId: saved.json.assessmentId, status: 'published' })).status).toBe(200);
  return saved.json.assessmentId;
}

beforeAll(async () => {
  if (!PROJECT.startsWith('demo-')) throw new Error(`Refusing to run against non-demo project ${PROJECT}`);
  process.env.FIREBASE_ADMIN_PROJECT_ID = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  ({ db, auth } = getAdminServices());
  for (const uid of USERS) {
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.createUser({ uid, email: `${uid}@al.test` });
  }
});

beforeEach(async () => {
  tokens.clear();
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const put = (p: string, d: Record<string, unknown>) => db.doc(p).set(d);
  const u = (uid: string, role: string, extra: Record<string, unknown> = {}) => put(`users/${uid}`, { role, orgId: 'org_a', status: 'active', email: `${uid}@al.test`, displayName: uid, createdAt: NOW, updatedAt: NOW, ...extra });
  await put('organizations/org_a', { name: 'Strynkix Academy', slug: 'strynkix', status: 'active' });
  await put('branches/b1', { orgId: 'org_a', name: 'Pune', code: 'PUN', status: 'active' });
  await put('branches/b2', { orgId: 'org_a', name: 'Mumbai', code: 'MUM', status: 'active' });
  await u('al_sa', 'super_admin');
  await u('al_ua', 'university_admin');
  await u('al_ba1', 'branch_admin', { branchId: 'b1' });
  await u('al_ba2', 'branch_admin', { branchId: 'b2' });
  await u('al_inst', 'instructor', { branchId: 'b1' });
  await u('al_inst2', 'instructor', { branchId: 'b1' });
  await u('al_stu', 'student', { branchId: 'b1' });
  await u('al_stu2', 'student', { branchId: 'b1' });
  await u('al_stuB', 'student', { branchId: 'b2' });
  await u('al_stuX', 'student', { orgId: 'org_b', branchId: 'bx' });
  await u('al_des', 'content_designer', { courseDesign: { department: 'course_design', responsibilities: ['assessment_designer'], assignedCourseIds: ['c1'], assignedAt: NOW, assignedByUserId: 'al_sa' } });
  await put('courses/c1', { orgId: 'org_a', title: 'Full-Stack Web', status: 'published', createdById: 'al_sa', createdAt: NOW, updatedAt: NOW });
  await put('modules/m1', { orgId: 'org_a', courseId: 'c1', title: 'Basics', orderIndex: 1, status: 'published' });
  for (const l of ['l1', 'l2']) await put(`lessons/${l}`, { orgId: 'org_a', courseId: 'c1', moduleId: 'm1', title: l, status: 'published', blocks: [], orderIndex: 1 });
  await put('batches/bt1', { orgId: 'org_a', branchId: 'b1', courseId: 'c1', name: 'Pune Alpha', code: 'PA', instructorUserIds: ['al_inst'], instructorNames: ['al_inst'], startDate: '2026-01-01', status: 'in_progress' });
  await put('batches/bt2', { orgId: 'org_a', branchId: 'b2', courseId: 'c1', name: 'Mumbai Alpha', code: 'MA', instructorUserIds: [], startDate: '2026-01-01', status: 'in_progress' });
  const enroll = (stu: string, batch: string, branch: string) => put(`enrollments/c1_${stu}`, { orgId: 'org_a', branchId: branch, courseId: 'c1', batchId: batch, studentId: stu, status: 'active', studentDisplayName: stu, enrolledAt: NOW, createdAt: NOW, updatedAt: NOW });
  await enroll('al_stu', 'bt1', 'b1');
  await enroll('al_stu2', 'bt1', 'b1');
  await enroll('al_stuB', 'bt2', 'b2');
});

describe('authoring keeps answers on the server', () => {
  it('an in-scope assessment designer creates a quiz; the key is stored apart and never sent to students', async () => {
    const id = await createPublished('al_des', quiz());
    expect(await get(`assessments/${id}`)).toMatchObject({ orgId: 'org_a', totalMarks: 4, status: 'published', createdById: 'al_des' });
    expect(JSON.stringify(await get(`assessments/${id}`))).not.toContain('correctOptionIds');
    expect((await get(`assessments/${id}/key/current`))!.items).toEqual([{ questionId: 'q1', correctOptionIds: ['b'] }, { questionId: 'q2', correctOptionIds: ['a', 'c'] }]);
    const seen = await A('al_stu', { action: 'student_get', assessmentId: id });
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.json)).not.toContain('correctOptionIds');
    expect((await audits('assessment_create'))).toHaveLength(1);
  });

  it('refuses non-authors, other academies and inconsistent questions', async () => {
    expect((await A('al_ba1', { action: 'save', assessment: quiz() })).status).toBe(403);
    expect((await A('al_stu', { action: 'save', assessment: quiz() })).status).toBe(403);
    expect((await A('al_stuX', { action: 'save', assessment: quiz() })).status).toBe(404); // another academy's course doesn't exist for them
    expect((await A('al_inst', { action: 'save', assessment: quiz({ questions: [mcq('q1', ['a', 'b'])] }) })).status).toBe(400);
    expect((await A('al_inst', { action: 'save', assessment: quiz({ questions: [mcq('q1', ['z'])] }) })).status).toBe(400);
    expect((await A('al_inst', { action: 'save', assessment: quiz({ negativeMarking: false, questions: [mcq('q1', ['a'], 2, 'mcq_single', 1)] }) })).status).toBe(400);
    expect((await A('al_inst', { action: 'save', assessment: quiz({ kind: 'short_answer' }) })).status).toBe(400);
    expect((await A('al_inst', { action: 'save', assessment: quiz({ lessonId: 'nope' }) })).status).toBe(400);
    expect((await A('al_inst', { action: 'save', assessment: { ...quiz(), status: 'published' } })).status).toBe(400);
  });
});

describe('student attempts and automatic marking', () => {
  it('scores MCQs with negative marking, keeps every attempt, limits attempts and reveals answers only when allowed', async () => {
    const id = await createPublished('al_inst', quiz());
    const s1 = await A('al_stu', { action: 'start', assessmentId: id });
    expect(s1.json).toMatchObject({ resumed: false });
    // Resuming returns the same attempt.
    expect((await A('al_stu', { action: 'start', assessmentId: id })).json).toEqual({ attemptId: s1.json.attemptId, resumed: true });
    const r1 = await A('al_stu', { action: 'submit', attemptId: s1.json.attemptId, responses: { q1: { optionIds: ['a'] }, q2: { optionIds: ['a', 'c'] } } });
    expect(r1.json).toMatchObject({ status: 'evaluated', released: true, score: 1, percent: 25, passed: false });
    let view = await A('al_stu', { action: 'student_get', assessmentId: id });
    expect(view.json.attempts[0]).toMatchObject({ score: 1, released: true });
    expect(view.json.attempts[0].review).toBeUndefined(); // one attempt left: answers stay hidden
    // A submitted attempt can't be changed.
    expect((await A('al_stu', { action: 'submit', attemptId: s1.json.attemptId, responses: {} })).status).toBe(409);
    const s2 = await A('al_stu', { action: 'start', assessmentId: id });
    await A('al_stu', { action: 'submit', attemptId: s2.json.attemptId, responses: { q1: { optionIds: ['b'] } } });
    view = await A('al_stu', { action: 'student_get', assessmentId: id });
    expect(view.json.attempts.map((t: { attemptNumber: number }) => t.attemptNumber)).toEqual([2, 1]);
    expect(view.json.attempts[0].review).toEqual([{ questionId: 'q1', correctOptionIds: ['b'] }, { questionId: 'q2', correctOptionIds: ['a', 'c'] }]);
    expect(view.json.canStart).toBe(false);
    expect((await A('al_stu', { action: 'start', assessmentId: id })).status).toBe(409);
    // Another student can't touch this attempt.
    expect((await A('al_stu2', { action: 'save_progress', attemptId: s2.json.attemptId, responses: {} })).status).toBe(404);
  });

  it('batch-limited, unpublished and other-academy activities are invisible', async () => {
    const id = await createPublished('al_inst', quiz({ batchIds: ['bt1'] }));
    expect((await A('al_stuB', { action: 'student_get', assessmentId: id })).status).toBe(404);
    expect((await A('al_stuX', { action: 'student_get', assessmentId: id })).status).toBe(404);
    expect((await A('al_stu', { action: 'student_list', lessonId: 'l1' })).json.assessments).toHaveLength(1);
    expect((await A('al_stuB', { action: 'student_list' })).json.assessments).toHaveLength(0);
    const draft = await A('al_inst', { action: 'save', assessment: quiz() });
    expect((await A('al_stu', { action: 'student_get', assessmentId: draft.json.assessmentId })).status).toBe(404);
  });

  it('time limits: saving after time is up is refused and a late submit is flagged', async () => {
    const id = await createPublished('al_inst', quiz({ timeLimitMinutes: 5 }));
    const s = await A('al_stu', { action: 'start', assessmentId: id });
    expect((await get(`assessmentAttempts/${s.json.attemptId}`))!.deadlineAt).toBeTruthy();
    await db.doc(`assessmentAttempts/${s.json.attemptId}`).update({ deadlineAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect((await A('al_stu', { action: 'save_progress', attemptId: s.json.attemptId, responses: {} })).json.error).toBe('time_up');
    await A('al_stu', { action: 'submit', attemptId: s.json.attemptId, responses: {} });
    expect(await get(`assessmentAttempts/${s.json.attemptId}`)).toMatchObject({ overTime: true, status: 'evaluated' });
  });
});

describe('manual evaluation, return and resubmission', () => {
  const written = { courseId: 'c1', lessonId: 'l2', kind: 'short_answer', title: 'Explain closures', passingPercent: 50, maxAttempts: 1, resultRelease: 'immediate', allowResubmission: true, questions: [{ id: 'w1', type: 'short', prompt: 'What is a closure?', marks: 10, modelAnswer: 'A function with its scope.' }] };

  it('only the batch’s instructor or branch managers evaluate; marks are bounded; history is kept', async () => {
    const id = await createPublished('al_inst', written);
    const s = await A('al_stu', { action: 'start', assessmentId: id });
    expect((await A('al_stu', { action: 'submit', attemptId: s.json.attemptId, responses: { w1: { text: 'A function that remembers.' } } })).json.status).toBe('submitted');
    const attemptId = s.json.attemptId;
    expect((await A('al_inst2', { action: 'evaluate', attemptId, manualScores: { w1: 5 }, finalize: true })).status).toBe(403);
    expect((await A('al_ba2', { action: 'evaluate', attemptId, manualScores: { w1: 5 }, finalize: true })).status).toBe(403);
    expect((await A('al_stu', { action: 'evaluate', attemptId, manualScores: { w1: 10 }, finalize: true })).status).toBe(403);
    expect((await A('al_inst', { action: 'evaluate', attemptId, manualScores: { w1: 11 }, finalize: true })).status).toBe(400);
    expect((await A('al_inst', { action: 'evaluate', attemptId, manualScores: {}, finalize: true })).status).toBe(400);
    // Queue: the instructor sees it; the other branch's manager doesn't.
    expect((await A('al_inst', { action: 'evaluation_queue' })).json.attempts.map((t: { id: string }) => t.id)).toEqual([attemptId]);
    expect((await A('al_ba2', { action: 'evaluation_queue' })).json.attempts).toEqual([]);
    // Return for correction, then the student resubmits as a new attempt (beyond maxAttempts=1).
    expect((await A('al_inst', { action: 'return', attemptId, reason: 'Add an example please.' })).json.status).toBe('returned');
    const s2 = await A('al_stu', { action: 'start', assessmentId: id });
    expect(s2.status).toBe(200);
    await A('al_stu', { action: 'submit', attemptId: s2.json.attemptId, responses: { w1: { text: 'A function plus its scope, e.g. counters.' } } });
    expect(await get(`assessmentAttempts/${s2.json.attemptId}`)).toMatchObject({ resubmission: true, attemptNumber: 2 });
    expect(await get(`assessmentAttempts/${attemptId}`)).toMatchObject({ status: 'returned', responses: { w1: { text: 'A function that remembers.' } } });
    const done = await A('al_ba1', { action: 'evaluate', attemptId: s2.json.attemptId, manualScores: { w1: 8 }, feedback: 'Good.', finalize: true });
    expect(done.json).toMatchObject({ status: 'evaluated', score: 8, percent: 80, passed: true });
    const n = (await db.collection('notifications').where('userId', '==', 'al_stu').get()).docs.map((d) => d.data().type).sort();
    expect(n).toEqual(['assessment_evaluated', 'assessment_returned']);
    expect(await audits('attempt_evaluated')).toHaveLength(1);
  });

  it('exam results stay hidden until released; questions lock once attempted', async () => {
    const exam = { courseId: 'c1', kind: 'exam', examType: 'final', title: 'Final exam', passingPercent: 40, maxAttempts: 1, resultRelease: 'manual', allowResubmission: false,
      questions: [mcq('e1', ['a'], 4), { id: 'e2', type: 'long', prompt: 'Design a REST API.', marks: 6 }] };
    const id = await createPublished('al_ua', exam);
    const s = await A('al_stu', { action: 'start', assessmentId: id });
    await A('al_stu', { action: 'submit', attemptId: s.json.attemptId, responses: { e1: { optionIds: ['a'] }, e2: { text: 'GET /items …' } } });
    expect((await A('al_inst', { action: 'evaluate', attemptId: s.json.attemptId, manualScores: { e2: 5 }, finalize: true })).json.score).toBe(9);
    let view = await A('al_stu', { action: 'student_get', assessmentId: id });
    expect(view.json.attempts[0].released).toBe(false);
    expect(view.json.attempts[0].score).toBeUndefined();
    expect((await A('al_stu', { action: 'release_results', assessmentId: id })).status).toBe(403);
    expect((await A('al_ua', { action: 'release_results', assessmentId: id })).status).toBe(200);
    view = await A('al_stu', { action: 'student_get', assessmentId: id });
    expect(view.json.attempts[0]).toMatchObject({ released: true, score: 9, passed: true });
    // Locked: changing marks is refused; changing the instructions is fine.
    const edit = await A('al_ua', { action: 'get_for_edit', assessmentId: id });
    expect(edit.json.locked).toBe(true);
    expect((await A('al_ua', { action: 'save', assessmentId: id, assessment: { ...exam, questions: [mcq('e1', ['b'], 4), exam.questions[1]] } })).json.error).toBe('locked');
    expect((await A('al_ua', { action: 'save', assessmentId: id, assessment: { ...exam, instructions: 'Bring a pen.' } })).status).toBe(200);
    expect((await A('al_ua', { action: 'set_status', assessmentId: id, status: 'draft' })).status).toBe(409);
  });
});

describe('attendance', () => {
  const T = (uid: string, body: unknown) => call(attendance, uid, body);
  it('the batch’s instructor records and corrects (audited); others are refused; students read only their own', async () => {
    const day = '2026-09-01';
    expect((await T('al_inst', { action: 'save_session', batchId: 'bt1', date: day, records: { al_stu: 'present', al_stu2: 'absent' } })).status).toBe(200);
    expect((await T('al_inst2', { action: 'save_session', batchId: 'bt1', date: day, records: { al_stu: 'absent' } })).status).toBe(403);
    expect((await T('al_ba2', { action: 'batch_sheet', batchId: 'bt1', date: day })).status).toBe(403);
    expect((await T('al_stu', { action: 'save_session', batchId: 'bt1', date: day, records: { al_stu: 'present' } })).status).toBe(403);
    expect((await T('al_inst', { action: 'save_session', batchId: 'bt1', date: day, records: { al_stuB: 'present' } })).status).toBe(400);
    expect((await T('al_inst', { action: 'save_session', batchId: 'bt1', date: '2099-01-01', records: { al_stu: 'present' } })).status).toBe(400);
    expect((await T('al_ba1', { action: 'save_session', batchId: 'bt1', date: day, records: { al_stu2: 'excused' } })).json.changed).toBe(1);
    expect((await audits('attendance_corrected'))[0].changes).toEqual([{ studentId: 'al_stu2', from: 'absent', to: 'excused' }]);
    await T('al_inst', { action: 'save_session', batchId: 'bt1', date: '2026-09-02', records: { al_stu: 'late', al_stu2: 'absent' } });
    const mine = await T('al_stu2', { action: 'my_attendance' });
    expect(mine.json.batches[0].stats).toMatchObject({ scheduled: 2, excused: 1, absent: 1, percent: 0 });
    expect(JSON.stringify(mine.json)).not.toContain('al_stu"'); // no classmates' records
    const report = await T('al_ba1', { action: 'batch_report', batchId: 'bt1' });
    expect(report.json.students.find((s: { studentId: string }) => s.studentId === 'al_stu')).toMatchObject({ present: 1, late: 1, percent: 100 });
  });
});

describe('certificates', () => {
  const C = (uid: string, body: unknown) => call(certificates, uid, body);
  const policy = { minCompletionPercent: 100, minAttendancePercent: 0, requireFinalExamPass: false, minAveragePercent: 0, signatoryName: 'R. Director', signatoryTitle: 'Director' };

  it('issued once, only when eligible, by the student’s branch; verifiable and revocable', async () => {
    expect((await C('al_ba1', { action: 'save_policy', courseId: 'c1', policy })).status).toBe(403);
    expect((await C('al_ua', { action: 'save_policy', courseId: 'c1', policy })).status).toBe(200);
    const notYet = await C('al_ba1', { action: 'issue', courseId: 'c1', studentId: 'al_stu' });
    expect(notYet).toMatchObject({ status: 409, json: { error: 'not_eligible' } });
    for (const l of ['l1', 'l2']) await db.doc(`progress/al_stu_${l}`).set({ orgId: 'org_a', courseId: 'c1', moduleId: 'm1', lessonId: l, studentId: 'al_stu', batchId: 'bt1', status: 'completed', timeSpentSeconds: 60, lastAccessedAt: NOW, createdAt: NOW, updatedAt: NOW });
    expect((await C('al_ba2', { action: 'issue', courseId: 'c1', studentId: 'al_stu' })).status).toBe(403);
    expect((await C('al_inst', { action: 'issue', courseId: 'c1', studentId: 'al_stu' })).status).toBe(403);
    const issued = await C('al_ba1', { action: 'issue', courseId: 'c1', studentId: 'al_stu' });
    expect(issued.json.certificateNumber).toMatch(/^STRYNKIX-PUN-\d{4}-00001$/);
    expect((await C('al_ba1', { action: 'issue', courseId: 'c1', studentId: 'al_stu' })).json.error).toBe('duplicate');
    const cert = (await get('certificates/c1_al_stu'))!;
    const v = await (await verify(new Request(`http://localhost/api/certificates/verify?code=${cert.verificationCode}`))).json();
    expect(v).toMatchObject({ valid: true, studentName: 'al_stu', courseTitle: 'Full-Stack Web' });
    expect(Object.keys(v)).not.toContain('studentId');
    expect((await C('al_stu2', { action: 'get', certificateId: 'c1_al_stu' })).status).toBe(404);
    expect((await C('al_stu', { action: 'get', certificateId: 'c1_al_stu' })).status).toBe(200);
    expect((await C('al_ba1', { action: 'revoke', certificateId: 'c1_al_stu', reason: 'Issued in error' })).status).toBe(403);
    expect((await C('al_ua', { action: 'revoke', certificateId: 'c1_al_stu', reason: 'Issued in error' })).status).toBe(200);
    expect(await (await verify(new Request(`http://localhost/api/certificates/verify?code=${cert.verificationCode}`))).json()).toMatchObject({ valid: false, status: 'revoked' });
    expect((await C('al_stu', { action: 'my_certificates' })).json.certificates[0]).toMatchObject({ status: 'revoked' });
    expect(await audits('certificate_issue')).toHaveLength(1);
  });
});

describe('student records', () => {
  it('overview and scores are the student’s own, with unreleased marks hidden', async () => {
    const id = await createPublished('al_inst', quiz({ resultRelease: 'manual' }));
    const s = await A('al_stu', { action: 'start', assessmentId: id });
    await A('al_stu', { action: 'submit', attemptId: s.json.attemptId, responses: { q1: { optionIds: ['b'] } } });
    const scores = await call(student, 'al_stu', { action: 'scores' });
    expect(scores.json.assessments[0]).toMatchObject({ released: false, status: 'evaluated' });
    expect(scores.json.assessments[0].score).toBeUndefined();
    const overview = await call(student, 'al_stu', { action: 'overview' });
    expect(overview.json.courses[0]).toMatchObject({ courseId: 'c1', batchName: 'Pune Alpha', totalLessons: 2 });
    expect((await call(student, 'al_inst', { action: 'overview' })).status).toBe(403);
    const stu2 = await call(student, 'al_stu2', { action: 'scores' });
    expect(stu2.json.assessments).toEqual([]);
  });
});

describe('review fixes', () => {
  it('after the time limit only the answers autosaved in time are scored', async () => {
    const id = await createPublished('al_inst', quiz({ timeLimitMinutes: 5 }));
    const s = await A('al_stu', { action: 'start', assessmentId: id });
    expect((await A('al_stu', { action: 'save_progress', attemptId: s.json.attemptId, responses: { q1: { optionIds: ['b'] } } })).status).toBe(200);
    await db.doc(`assessmentAttempts/${s.json.attemptId}`).update({ deadlineAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    // Late answers (q2 correct) are ignored; the saved q1 answer counts.
    const r = await A('al_stu', { action: 'submit', attemptId: s.json.attemptId, responses: { q1: { optionIds: ['b'] }, q2: { optionIds: ['a', 'c'] } } });
    expect(r.json).toMatchObject({ status: 'evaluated', score: 2 });
    expect((await get(`assessmentAttempts/${s.json.attemptId}`))!.responses).toEqual({ q1: { optionIds: ['b'] } });
  });

  it('a Branch Manager can’t release results for the whole academy', async () => {
    const id = await createPublished('al_ua', quiz({ resultRelease: 'manual' }));
    expect((await A('al_ba1', { action: 'release_results', assessmentId: id })).status).toBe(403);
    expect((await A('al_inst', { action: 'release_results', assessmentId: id })).status).toBe(200); // an author
  });

  it('only the student’s own instructors (and branch managers) open a certificate', async () => {
    await db.doc('certificates/c1_al_stu').set({ orgId: 'org_a', branchId: 'b1', courseId: 'c1', studentId: 'al_stu', status: 'issued', certificateNumber: 'X-1', verificationCode: 'abcdefgh12' });
    const C = (uid: string) => call(certificates, uid, { action: 'get', certificateId: 'c1_al_stu' });
    expect((await C('al_inst2')).status).toBe(404);
    expect((await C('al_ba2')).status).toBe(404);
    expect((await C('al_inst')).status).toBe(200);
    expect((await C('al_ba1')).status).toBe(200);
  });
});

