'use client';

/**
 * Strynkix LMS — guided student admission in five steps. Each "Next" saves
 * the draft on the server; confirming runs the trusted admission (account,
 * enrollment, fee account, first payment and receipt) in one step.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { admissionsApi } from '@/lib/academy/api';
import { getBranches } from '@/lib/admin/service';
import { discountAmount, equalInstallments, needsApproval, scheduleError } from '@/lib/finance/fees';
import { formatDate, formatMoney, toPaise, todayLocal } from '@/lib/academy/format';
import type { AcademicDetails, Admission, CoursePricing, FeePlanInput, InstallmentPlanItem, PaymentMethod, PersonalDetails } from '@/types/academy';
import type { Branch } from '@/types/domain';
import { Button, buttonClasses } from '@/components/ui/Button';
import { Card, Field, fieldClasses } from '@/components/ui/Page';
import { ErrorState, LoadingState, Notice } from '@/components/ui/States';
import { cx } from '@/components/ui/tones';
import { CheckCircle2 } from 'lucide-react';

interface Options {
  branch: { id: string; name: string };
  courses: { id: string; title: string; description: string; weeks: number | null; pricing: CoursePricing; gross: number }[];
  batches: { id: string; courseId: string; name: string; code: string; startDate: string; endDate: string | null; instructors: string[]; seatsLeft: number | null }[];
}

const STEPS = ['Personal details', 'Academic background', 'Course and batch', 'Fees and payment', 'Review and confirm'];
const METHODS: { id: PaymentMethod; label: string }[] = [{ id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI' }, { id: 'bank_transfer', label: 'Bank transfer' }, { id: 'card', label: 'Card' }, { id: 'cheque', label: 'Cheque' }, { id: 'other', label: 'Other' }];
const EMPTY_PERSONAL: Partial<PersonalDetails> = { firstName: '', lastName: '', email: '', mobile: '' };

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as T;

export function AdmissionWizard({ initial }: { initial?: Admission }) {
  const { tenant } = useAuth();
  const [step, setStep] = useState(0);
  const [admissionId, setAdmissionId] = useState<string | undefined>(initial?.id);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(initial?.branchId ?? (tenant?.role === 'branch_admin' ? tenant.branchId ?? '' : ''));
  const [personal, setPersonal] = useState<Partial<PersonalDetails>>(initial?.personal ?? EMPTY_PERSONAL);
  const [academic, setAcademic] = useState<AcademicDetails>(initial?.academic ?? {});
  const [courseId, setCourseId] = useState(initial?.courseId ?? '');
  const [batchId, setBatchId] = useState(initial?.batchId ?? '');
  const [discountType, setDiscountType] = useState<FeePlanInput['discountType']>(initial?.fee?.discountType ?? 'none');
  const [discountInput, setDiscountInput] = useState(initial?.fee ? (initial.fee.discountType === 'percent' ? String(initial.fee.discountValue / 100) : initial.fee.discountType === 'fixed' ? String(initial.fee.discountValue / 100) : '') : '');
  const [discountReason, setDiscountReason] = useState(initial?.fee?.discountReason ?? '');
  const [plan, setPlan] = useState<FeePlanInput['plan']>(initial?.fee?.plan ?? 'one_time');
  const [schedule, setSchedule] = useState<InstallmentPlanItem[]>(initial?.fee?.installments ?? []);
  const [firstDue, setFirstDue] = useState(initial?.fee?.installments?.[0]?.dueDate ?? todayLocal());
  const [payNow, setPayNow] = useState(initial?.fee?.initialPayment ? String(initial.fee.initialPayment.amount / 100) : '');
  const [payMethod, setPayMethod] = useState<PaymentMethod>(initial?.fee?.initialPayment?.method ?? 'cash');
  const [payRef, setPayRef] = useState(initial?.fee?.initialPayment?.reference ?? '');
  const [password, setPassword] = useState('');
  const [options, setOptions] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ admissionNumber: string; studentId: string; feeAccountId: string; receiptTransactionId: string | null; discountPending: boolean; accountExisted: boolean } | null>(null);

  useEffect(() => {
    if (!tenant || tenant.role === 'branch_admin') return;
    getBranches(tenant.orgId).then((b) => setBranches(b.filter((x) => x.status === 'active'))).catch(() => setBranches([]));
  }, [tenant]);
  useEffect(() => {
    if (!branchId) return;
    let live = true;
    admissionsApi<Options>({ action: 'options', branchId }).then((o) => live && setOptions(o)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [branchId]);

  const course = options?.courses.find((c) => c.id === courseId) ?? null;
  const batch = options?.batches.find((b) => b.id === batchId) ?? null;
  const discountValue = discountType === 'percent' ? Math.round(Number(discountInput || 0) * 100) : discountType === 'fixed' ? toPaise(discountInput || '0') ?? 0 : 0;
  const gross = course?.gross ?? 0;
  const dAmount = discountAmount(gross, discountType, discountValue);
  const pending = course && tenant ? needsApproval(tenant.role, course.pricing, gross, dAmount) : false;
  const payable = pending ? gross : gross - dAmount;
  const effectiveSchedule = plan === 'one_time' ? [{ number: 1, dueDate: firstDue, amount: payable }] : schedule;
  const schedErr = course ? scheduleError(effectiveSchedule, payable) : null;
  const payNowPaise = payNow ? toPaise(payNow) : 0;

  const fee = (): FeePlanInput | undefined => (course ? {
    discountType, discountValue, ...(discountReason.trim() ? { discountReason: discountReason.trim() } : {}), plan, installments: effectiveSchedule,
    ...(payNowPaise ? { initialPayment: { amount: payNowPaise, method: payMethod, ...(payRef.trim() ? { reference: payRef.trim() } : {}) } } : {}),
  } : undefined);

  const stepError = (): string | null => {
    if (step === 0) {
      if (!branchId) return 'Choose the branch.';
      if (!personal.firstName?.trim() || !personal.lastName?.trim()) return 'Enter the first name and surname.';
      if (!/^\S+@\S+\.\S+$/.test(personal.email ?? '')) return 'Enter a valid email address. The student signs in with it.';
      if (!/^\+?[0-9\s-]{7,20}$/.test(personal.mobile ?? '')) return 'Enter a valid mobile number.';
      if (personal.pinCode && !/^\d{6}$/.test(personal.pinCode)) return 'PIN code is 6 digits.';
    }
    if (step === 2 && (!courseId || !batchId)) return 'Choose a course and a batch.';
    if (step === 3) {
      if (dAmount > 0 && !discountReason.trim()) return 'Give a reason for the discount.';
      if (discountType !== 'none' && dAmount === 0) return 'Enter the discount amount, or choose “No discount”.';
      if (schedErr) return schedErr;
      if (payNow && payNowPaise === null) return 'Enter the payment as an amount in rupees, like 5000 or 5000.50.';
      if (payNowPaise && payNowPaise > gross - dAmount) return 'The first payment is more than the fee.';
      if (payNowPaise && payMethod !== 'cash' && !payRef.trim()) return 'Add the transaction reference for non-cash payments.';
    }
    return null;
  };

  const saveDraft = async () => {
    const r = await admissionsApi<{ admissionId: string }>({
      action: 'save_draft', ...(admissionId ? { admissionId } : {}), branchId, personal: clean(personal), academic: clean(academic),
      ...(courseId ? { courseId } : {}), ...(batchId ? { batchId } : {}), ...(step >= 3 && fee() ? { fee: fee() } : {}),
    });
    setAdmissionId(r.admissionId);
    return r.admissionId;
  };

  const next = async () => {
    const err = stepError();
    if (err) { setError(err); return; }
    setBusy(true);
    setError(null);
    try { await saveDraft(); setStep((s) => s + 1); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const confirmAdmission = async () => {
    if (password.length < 8) { setError('Set an initial password of at least 8 characters for the student.'); return; }
    setBusy(true);
    setError(null);
    try {
      const id = await saveDraft();
      setDone(await admissionsApi({ action: 'confirm', admissionId: id, password }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden="true" />
        <h2 className="type-section text-ink">Admission confirmed</h2>
        <p className="text-sm text-ink-2">Admission number <strong>{done.admissionNumber}</strong>. {personal.firstName} can sign in with {personal.email}{done.accountExisted ? ' (their existing account was used)' : ' and the initial password you set'}.</p>
        {done.discountPending && <Notice kind="warning">The discount is above your limit and is waiting for approval. Payments are limited to the discounted amount until it is decided.</Notice>}
        <div className="flex flex-wrap justify-center gap-2">
          {done.receiptTransactionId && <Link href={`/receipts/${done.receiptTransactionId}`} className={buttonClasses('primary')}>Print receipt</Link>}
          <Link href={`/dashboard/finance/accounts/${done.feeAccountId}`} className={buttonClasses('secondary')}>Fee account</Link>
          <Link href={`/dashboard/people/${done.studentId}`} className={buttonClasses('secondary')}>Student profile</Link>
          <Link href="/dashboard/admissions/new" className={buttonClasses('ghost')}>New admission</Link>
        </div>
      </Card>
    );
  }

  const P = (k: keyof PersonalDetails, label: string, opts: { type?: string; required?: boolean; hint?: string } = {}) => (
    <Field label={label} htmlFor={`p-${k}`} required={opts.required} hint={opts.hint}>
      <input id={`p-${k}`} type={opts.type ?? 'text'} value={(personal[k] as string) ?? ''} onChange={(e) => setPersonal((p) => ({ ...p, [k]: e.target.value }))} className={fieldClasses} />
    </Field>
  );

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Admission steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={cx('flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold', i === step ? 'border-brand bg-brand text-white' : i < step ? 'border-success-line bg-success-soft text-success-ink' : 'border-line text-ink-3')}>
            <span>{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      <Card className="space-y-5 p-5 sm:p-6">
        {step === 0 && (
          <>
            {tenant?.role !== 'branch_admin' && (
              <Field label="Branch" htmlFor="branch" required>
                <select id="branch" value={branchId} disabled={Boolean(admissionId)} onChange={(e) => { setBranchId(e.target.value); setCourseId(''); setBatchId(''); }} className={fieldClasses}>
                  <option value="">Choose a branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </select>
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-3">{P('firstName', 'First name', { required: true })}{P('middleName', 'Middle name')}{P('lastName', 'Surname', { required: true })}</div>
            <div className="grid gap-4 sm:grid-cols-3">
              {P('dateOfBirth', 'Date of birth', { type: 'date' })}
              <Field label="Gender (if your academy records it)" htmlFor="p-gender">
                <select id="p-gender" value={personal.gender ?? ''} onChange={(e) => setPersonal((p) => ({ ...p, gender: e.target.value }))} className={fieldClasses}>
                  <option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Other</option>
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">{P('email', 'Email address', { type: 'email', required: true, hint: 'The student signs in with this email.' })}{P('mobile', 'Mobile number', { type: 'tel', required: true })}</div>
            <div className="grid gap-4 sm:grid-cols-3">{P('emergencyName', 'Emergency contact name')}{P('emergencyRelation', 'Relationship')}{P('emergencyPhone', 'Emergency contact number', { type: 'tel' })}</div>
            {P('address', 'Address')}
            <div className="grid gap-4 sm:grid-cols-3">{P('city', 'City')}{P('state', 'State')}{P('pinCode', 'PIN code')}</div>
          </>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {([['highestQualification', 'Highest qualification'], ['currentOccupation', 'Current education or occupation'], ['institution', 'College or institution']] as const).map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`a-${k}`}><input id={`a-${k}`} value={academic[k] ?? ''} onChange={(e) => setAcademic((a) => ({ ...a, [k]: e.target.value }))} className={fieldClasses} /></Field>
            ))}
            <div className="sm:col-span-2"><Field label="Previous technical experience" htmlFor="a-tech"><textarea id="a-tech" rows={3} value={academic.technicalExperience ?? ''} onChange={(e) => setAcademic((a) => ({ ...a, technicalExperience: e.target.value }))} className={fieldClasses} /></Field></div>
            <div className="sm:col-span-2"><Field label="Other relevant background" htmlFor="a-bg"><textarea id="a-bg" rows={2} value={academic.background ?? ''} onChange={(e) => setAcademic((a) => ({ ...a, background: e.target.value }))} className={fieldClasses} /></Field></div>
          </div>
        )}

        {step === 2 && (!options ? <LoadingState label="Loading courses and batches…" /> : options.courses.length === 0 ? (
          <Notice kind="warning">No course at this branch has an approved price yet. The Super Admin sets course pricing in Finance → Course pricing.</Notice>
        ) : (
          <div className="space-y-4">
            <Field label="Course" htmlFor="course" required>
              <select id="course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setBatchId(''); setSchedule([]); }} className={fieldClasses}>
                <option value="">Choose a course</option>
                {options.courses.map((c) => <option key={c.id} value={c.id}>{c.title} — {formatMoney(c.gross)}</option>)}
              </select>
            </Field>
            {course && (
              <div className="rounded-xl border border-line bg-surface-muted p-4 text-sm">
                <p className="text-ink-2">{course.description}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div><dt className="text-xs text-ink-3">Course fee</dt><dd className="font-semibold">{formatMoney(course.pricing.standardFee)}</dd></div>
                  <div><dt className="text-xs text-ink-3">Registration</dt><dd className="font-semibold">{formatMoney(course.pricing.registrationFee)}</dd></div>
                  {course.pricing.otherFees.map((f) => <div key={f.label}><dt className="text-xs text-ink-3">{f.label}</dt><dd className="font-semibold">{formatMoney(f.amount)}</dd></div>)}
                  <div><dt className="text-xs text-ink-3">Total</dt><dd className="font-semibold text-ink">{formatMoney(course.gross)}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-ink-3">Installments allowed: {course.pricing.installmentOptions.join(', ')}{course.weeks ? ` · about ${course.weeks} weeks` : ''}</p>
              </div>
            )}
            {course && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-ink-2">Batch</legend>
                {options.batches.filter((b) => b.courseId === course.id).length === 0 ? <Notice kind="warning">No open batch of this course at this branch. Create one in Batches & Enrollment first.</Notice> : options.batches.filter((b) => b.courseId === course.id).map((b) => (
                  <label key={b.id} className={cx('flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border p-3 text-sm', batchId === b.id ? 'border-brand bg-brand-soft' : 'border-line')}>
                    <input type="radio" name="batch" value={b.id} checked={batchId === b.id} disabled={b.seatsLeft === 0} onChange={() => setBatchId(b.id)} />
                    <span className="font-semibold text-ink">{b.name} ({b.code})</span>
                    <span className="text-ink-3">Starts {formatDate(b.startDate)}{b.endDate ? ` · ends ${formatDate(b.endDate)}` : ''} · {b.instructors.join(', ') || 'Instructor to be assigned'}</span>
                    {b.seatsLeft !== null && <span className={cx('text-xs font-semibold', b.seatsLeft === 0 ? 'text-danger-ink' : 'text-ink-3')}>{b.seatsLeft === 0 ? 'Full' : `${b.seatsLeft} seats left`}</span>}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        ))}

        {step === 3 && course && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Discount" htmlFor="dtype">
                <select id="dtype" value={discountType} onChange={(e) => { setDiscountType(e.target.value as FeePlanInput['discountType']); setDiscountInput(''); }} className={fieldClasses}>
                  <option value="none">No discount</option><option value="percent">Percentage (%)</option><option value="fixed">Fixed amount (₹)</option>
                </select>
              </Field>
              {discountType !== 'none' && <Field label={discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'} htmlFor="dval"><input id="dval" inputMode="decimal" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} className={fieldClasses} /></Field>}
              {discountType !== 'none' && <Field label="Reason" htmlFor="dreason" required><input id="dreason" value={discountReason} placeholder="e.g. Scholarship, referral" onChange={(e) => setDiscountReason(e.target.value)} className={fieldClasses} /></Field>}
            </div>
            <div className="rounded-xl border border-line p-4 text-sm">
              <div className="flex justify-between"><span>Standard fee</span><span>{formatMoney(gross)}</span></div>
              {dAmount > 0 && <div className="flex justify-between text-success-ink"><span>Discount</span><span>− {formatMoney(dAmount)}</span></div>}
              <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold text-ink"><span>Final payable fee</span><span>{formatMoney(gross - dAmount)}</span></div>
              {pending && <p className="mt-2 text-xs text-warning-ink">This discount is above your approval limit. It will be sent for approval; until then the schedule is for the full fee and payments are limited to {formatMoney(gross - dAmount)}.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Payment plan" htmlFor="plan">
                <select id="plan" value={plan} onChange={(e) => { const p = e.target.value as FeePlanInput['plan']; setPlan(p); if (p === 'installments') setSchedule(equalInstallments(payable, course.pricing.installmentOptions.find((n) => n > 1) ?? 2, firstDue)); }} className={fieldClasses}>
                  <option value="one_time">One-time payment</option>
                  {course.pricing.installmentOptions.some((n) => n > 1) && <option value="installments">Installments</option>}
                </select>
              </Field>
              <Field label={plan === 'one_time' ? 'Due date' : 'First installment due'} htmlFor="firstDue"><input id="firstDue" type="date" value={firstDue} onChange={(e) => { setFirstDue(e.target.value); if (plan === 'installments') setSchedule(equalInstallments(payable, schedule.length || 2, e.target.value)); }} className={fieldClasses} /></Field>
              {plan === 'installments' && (
                <Field label="Number of installments" htmlFor="count">
                  <select id="count" value={schedule.length} onChange={(e) => setSchedule(equalInstallments(payable, Number(e.target.value), firstDue))} className={fieldClasses}>
                    {course.pricing.installmentOptions.filter((n) => n > 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Field>
              )}
            </div>
            {plan === 'installments' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-ink">Installment schedule</h3><Button size="sm" variant="ghost" onClick={() => setSchedule(equalInstallments(payable, schedule.length || 2, firstDue))}>Split equally</Button></div>
                {schedule.map((it, i) => (
                  <div key={it.number} className="grid grid-cols-[40px_1fr_1fr] items-center gap-2">
                    <span className="text-sm text-ink-3">#{it.number}</span>
                    <input aria-label={`Installment ${it.number} due date`} type="date" value={it.dueDate} onChange={(e) => setSchedule((s) => s.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} className={fieldClasses} />
                    <input aria-label={`Installment ${it.number} amount (₹)`} inputMode="decimal" defaultValue={(it.amount / 100).toFixed(2)} key={`${it.number}-${it.amount}`} onBlur={(e) => { const v = toPaise(e.target.value); if (v !== null) setSchedule((s) => s.map((x, j) => (j === i ? { ...x, amount: v } : x))); }} className={fieldClasses} />
                  </div>
                ))}
                {schedErr && <p className="text-xs text-danger-ink" role="alert">{schedErr}</p>}
              </div>
            )}
            <fieldset className="grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-3">
              <legend className="px-1 text-sm font-semibold text-ink-2">Payment received now (optional)</legend>
              <Field label="Amount (₹)" htmlFor="pay"><input id="pay" inputMode="decimal" value={payNow} onChange={(e) => setPayNow(e.target.value)} className={fieldClasses} /></Field>
              <Field label="Method" htmlFor="paym"><select id="paym" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} className={fieldClasses}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
              <Field label="Transaction reference" htmlFor="payr" hint="UPI / bank reference. Never enter card numbers."><input id="payr" value={payRef} onChange={(e) => setPayRef(e.target.value)} className={fieldClasses} /></Field>
              {payNowPaise ? <p className="text-xs text-ink-3 sm:col-span-3">Remaining balance after this payment: {formatMoney(Math.max(0, (gross - dAmount) - payNowPaise))}</p> : null}
            </fieldset>
          </div>
        )}

        {step === 4 && course && batch && (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-ink-3">Student</dt><dd className="font-semibold">{[personal.firstName, personal.middleName, personal.lastName].filter(Boolean).join(' ')}</dd></div>
              <div><dt className="text-xs text-ink-3">Contact</dt><dd>{personal.email} · {personal.mobile}</dd></div>
              <div><dt className="text-xs text-ink-3">Branch</dt><dd>{options?.branch.name}</dd></div>
              <div><dt className="text-xs text-ink-3">Course and batch</dt><dd>{course.title} · {batch.name} (starts {formatDate(batch.startDate)})</dd></div>
              <div><dt className="text-xs text-ink-3">Fee</dt><dd>{formatMoney(gross)}{dAmount ? ` − ${formatMoney(dAmount)} discount${pending ? ' (needs approval)' : ''}` : ''} = <strong>{formatMoney(gross - dAmount)}</strong></dd></div>
              <div><dt className="text-xs text-ink-3">Plan</dt><dd>{plan === 'one_time' ? `One-time, due ${formatDate(firstDue)}` : `${schedule.length} installments: ${schedule.map((s) => `${formatMoney(s.amount)} on ${formatDate(s.dueDate)}`).join('; ')}`}</dd></div>
              <div><dt className="text-xs text-ink-3">Paid now</dt><dd>{payNowPaise ? `${formatMoney(payNowPaise)} by ${METHODS.find((m) => m.id === payMethod)!.label}` : 'Nothing'}</dd></div>
            </dl>
            <Field label="Initial password for the student" htmlFor="pw" required hint="At least 8 characters. Give it to the student; they can change it from their profile. If they already have an account, it is reused and this is ignored.">
              <input id="pw" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldClasses} max-w-sm font-mono`} />
            </Field>
          </div>
        )}

        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          {step > 0 && <Button variant="ghost" onClick={() => { setError(null); setStep((s) => s - 1); }} disabled={busy}>Back</Button>}
          {step < 4 ? <Button onClick={next} loading={busy}>Save and continue</Button> : <Button variant="success" onClick={confirmAdmission} loading={busy}>Confirm admission</Button>}
          {admissionId && <span className="self-center text-xs text-ink-3">Draft saved — you can finish it later from Admissions.</span>}
        </div>
      </Card>
    </div>
  );
}

export function AdmissionLoader({ admissionId }: { admissionId: string }) {
  const [data, setData] = useState<Admission | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    admissionsApi<{ admission: Admission }>({ action: 'get', admissionId }).then((r) => setData(r.admission)).catch((e) => setError((e as Error).message));
  }, [admissionId]);
  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState label="Loading the admission…" />;
  if (data.status !== 'draft') {
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p><strong>{[data.personal.firstName, data.personal.lastName].join(' ')}</strong> — {data.status === 'confirmed' ? `confirmed on ${formatDate(data.confirmedAt)} as ${data.admissionNumber}` : 'discarded draft'}.</p>
        {data.status === 'confirmed' && (
          <div className="flex flex-wrap gap-2">
            {data.feeAccountId && <Link href={`/dashboard/finance/accounts/${data.feeAccountId}`} className={buttonClasses('secondary', 'sm')}>Fee account</Link>}
            {data.studentId && <Link href={`/dashboard/people/${data.studentId}`} className={buttonClasses('secondary', 'sm')}>Student profile</Link>}
            <Link href={`/admissions/${data.id}/print`} className={buttonClasses('ghost', 'sm')}>Print admission form</Link>
          </div>
        )}
      </Card>
    );
  }
  return <AdmissionWizard initial={data} />;
}
