/**
 * Strynkix Coding Academy LMS — academy operations models: lesson activities
 * and examinations, attendance, certificates, admissions, personal records,
 * course pricing, fee ledgers, expenses, portfolio and resumes.
 *
 * Every collection here is server-only: firestore.rules deny all browser
 * access (default deny) and the trusted API routes authorize each request from
 * the caller's stored profile. Money is integer paise (₹1 = 100).
 */

// -----------------------------------------------------------------------------
// Assessments: lesson activities and examinations — assessments/{id}
// Answers live in assessments/{id}/key/current (never sent before release).
// -----------------------------------------------------------------------------
export type AssessmentKind = 'quiz' | 'short_answer' | 'long_answer' | 'practical' | 'exam';
export type ExamType = 'demo' | 'practice' | 'final';
export type QuestionType = 'mcq_single' | 'mcq_multi' | 'short' | 'long';
export type ResultRelease = 'immediate' | 'after_close' | 'manual';

export interface AssessmentQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: { id: string; text: string }[];
  marks: number;
  /** Marks taken away for a wrong MCQ answer when negative marking is on. */
  negativeMarks?: number;
}

export interface AssessmentKeyItem {
  questionId: string;
  correctOptionIds?: string[];
  /** Guidance for evaluators of written answers; shown to students after release. */
  modelAnswer?: string;
  explanation?: string;
}

export interface Assessment {
  id: string;
  orgId: string;
  courseId: string;
  moduleId?: string;
  lessonId?: string;
  /** Limit to these batches; absent = every batch of the course. */
  batchIds?: string[];
  kind: AssessmentKind;
  examType?: ExamType;
  title: string;
  description: string;
  instructions: string;
  questions: AssessmentQuestion[];
  /** Marks for a practical assignment (it has no questions). */
  practicalMarks?: number;
  totalMarks: number;
  passingPercent: number;
  /** 0 = unlimited. */
  maxAttempts: number;
  timeLimitMinutes?: number;
  opensAt?: string;
  closesAt?: string;
  allowLate: boolean;
  allowResubmission: boolean;
  negativeMarking: boolean;
  resultRelease: ResultRelease;
  resultsReleasedAt?: string;
  status: 'draft' | 'published' | 'archived';
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type AttemptStatus = 'in_progress' | 'submitted' | 'under_evaluation' | 'evaluated' | 'returned';

export interface AttemptResponse {
  optionIds?: string[];
  text?: string;
}

export interface AssessmentAttempt {
  id: string; // `${assessmentId}_${studentId}_${attemptNumber}` — every attempt kept
  assessmentId: string;
  orgId: string;
  branchId: string;
  courseId: string;
  batchId: string;
  studentId: string;
  studentName: string;
  kind: AssessmentKind;
  examType?: ExamType;
  title: string;
  attemptNumber: number;
  status: AttemptStatus;
  /** A new attempt after the previous one was returned for correction. */
  resubmission: boolean;
  late: boolean;
  /** Submitted after the time limit ran out. */
  overTime?: boolean;
  startedAt: string;
  deadlineAt?: string;
  submittedAt?: string;
  responses: Record<string, AttemptResponse>;
  practical?: { text?: string; repoUrl?: string; liveUrl?: string };
  autoScore?: number;
  manualScores?: Record<string, number>;
  score?: number;
  totalMarks: number;
  percent?: number;
  passed?: boolean;
  feedback?: string;
  questionFeedback?: Record<string, string>;
  evaluatedById?: string;
  evaluatedAt?: string;
  returnedReason?: string;
}

// -----------------------------------------------------------------------------
// Attendance — attendance/{batchId}_{YYYY-MM-DD}
// -----------------------------------------------------------------------------
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceSession {
  id: string;
  orgId: string;
  branchId: string;
  courseId: string;
  batchId: string;
  date: string;
  topic?: string;
  records: Record<string, AttendanceStatus>;
  takenById: string;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Certificates — certificatePolicies/{courseId}, certificates/{courseId}_{studentId}
// -----------------------------------------------------------------------------
export interface CertificatePolicy {
  courseId: string;
  orgId: string;
  minCompletionPercent: number;
  minAttendancePercent: number;
  requireFinalExamPass: boolean;
  minAveragePercent: number;
  signatoryName: string;
  signatoryTitle: string;
  updatedById: string;
  updatedAt: string;
}

export interface Certificate {
  id: string;
  orgId: string;
  branchId: string;
  courseId: string;
  studentId: string;
  studentName: string;
  courseTitle: string;
  academyName: string;
  certificateNumber: string;
  verificationCode: string;
  completedOn: string;
  signatoryName: string;
  signatoryTitle: string;
  status: 'issued' | 'revoked';
  revokedReason?: string;
  issuedById: string;
  issuedAt: string;
}

// -----------------------------------------------------------------------------
// People: admissions/{id}, personProfiles/{uid}
// -----------------------------------------------------------------------------
export interface PersonalDetails {
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: string;
  email: string;
  mobile: string;
  emergencyName?: string;
  emergencyRelation?: string;
  emergencyPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  pinCode?: string;
}

export interface AcademicDetails {
  highestQualification?: string;
  currentOccupation?: string;
  institution?: string;
  technicalExperience?: string;
  background?: string;
}

export type PaymentPlanType = 'one_time' | 'installments';

export interface InstallmentPlanItem {
  number: number;
  dueDate: string; // YYYY-MM-DD
  amount: number; // paise
}

export interface FeePlanInput {
  discountType: 'none' | 'fixed' | 'percent';
  discountValue: number; // paise for fixed, basis points (1% = 100) for percent
  discountReason?: string;
  plan: PaymentPlanType;
  installments: InstallmentPlanItem[];
  initialPayment?: { amount: number; method: PaymentMethod; reference?: string };
}

export type AdmissionStatus = 'draft' | 'confirmed' | 'cancelled';

export interface Admission {
  id: string;
  orgId: string;
  branchId: string;
  status: AdmissionStatus;
  admissionNumber?: string;
  personal: PersonalDetails;
  academic: AcademicDetails;
  courseId?: string;
  batchId?: string;
  fee?: FeePlanInput;
  studentId?: string;
  feeAccountId?: string;
  createdById: string;
  confirmedById?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonProfile {
  id: string; // uid
  orgId: string;
  branchId?: string;
  role: string;
  personal: PersonalDetails;
  academic?: AcademicDetails;
  professional?: {
    qualification?: string;
    specialization?: string;
    skills?: string[];
    experienceYears?: number;
    joiningDate?: string;
    employmentStatus?: 'active' | 'on_leave' | 'inactive';
    responsibilities?: string;
  };
  /** Visible only to finance-authorized users. */
  compensation?: { type: 'monthly' | 'hourly' | 'per_batch'; amount: number; notes?: string };
  admissionNumber?: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Finance: coursePricing/{courseId}, feeAccounts/{id}, feeTransactions/{id},
// discountRequests/{id}
// -----------------------------------------------------------------------------
export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'card' | 'cheque' | 'other';

export interface CoursePricing {
  courseId: string;
  orgId: string;
  currency: 'INR';
  standardFee: number;
  registrationFee: number;
  otherFees: { label: string; amount: number }[];
  /** Installment counts managers may offer. */
  installmentOptions: number[];
  /** Largest discount (basis points of the total) each role may approve. */
  discountLimits: { branch_admin: number; university_admin: number };
  available: boolean;
  version: number;
  approvedById: string;
  updatedAt: string;
}

export type DiscountStatus = 'none' | 'approved' | 'pending' | 'rejected';

export interface FeeAccount {
  id: string;
  orgId: string;
  branchId: string;
  courseId: string;
  batchId: string;
  studentId: string;
  studentName: string;
  admissionId: string;
  admissionNumber: string;
  courseTitle: string;
  currency: 'INR';
  /** Copied from pricing at admission; never changes afterwards. */
  pricingVersion: number;
  grossFee: number;
  discount: { type: 'none' | 'fixed' | 'percent'; value: number; amount: number; reason?: string; status: DiscountStatus; approvedById?: string; requestedById?: string };
  /** grossFee minus the approved discount, plus adjustments. */
  agreedFee: number;
  plan: PaymentPlanType;
  installments: InstallmentPlanItem[];
  /** Cached totals, maintained in the same transaction as every ledger entry. */
  totals: { paid: number; refunded: number; adjustments: number };
  status: 'active' | 'closed' | 'cancelled';
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type FeeTransactionType = 'payment' | 'refund' | 'adjustment' | 'reversal';

/** Immutable ledger entry. Corrections are new entries (reversal/adjustment). */
export interface FeeTransaction {
  id: string;
  orgId: string;
  branchId: string;
  courseId: string;
  feeAccountId: string;
  studentId: string;
  studentName: string;
  type: FeeTransactionType;
  /** Always positive; the type gives the direction. Adjustments are signed. */
  amount: number;
  method?: PaymentMethod;
  reference?: string;
  date: string; // YYYY-MM-DD the money moved
  receiptNumber?: string;
  reason?: string;
  reversesId?: string;
  reversedById?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Expenses: expenseCategories/{id}, expenses/{id}, recurringExpenses/{id}
// -----------------------------------------------------------------------------
export interface ExpenseCategory {
  id: string;
  orgId: string;
  name: string;
  builtIn: boolean;
  active: boolean;
}

export type RecurrenceFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Expense {
  id: string;
  orgId: string;
  branchId: string;
  title: string;
  categoryId: string;
  categoryName: string;
  description?: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  paidTo?: string;
  reference?: string;
  notes?: string;
  documentUrl?: string;
  recurringId?: string;
  period?: string;
  status: 'paid' | 'void';
  voidReason?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface RecurringExpense {
  id: string;
  orgId: string;
  branchId: string;
  title: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string;
  paidTo?: string;
  /** Periods (YYYY-MM-DD of the due date) cancelled without payment. */
  cancelledPeriods: string[];
  active: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Portfolio and resume — portfolioEntries/{id}, resumes/{id}
// -----------------------------------------------------------------------------
export interface PortfolioEntry {
  id: string;
  orgId: string;
  studentId: string;
  title: string;
  description: string;
  skills: string[];
  technologies: string[];
  repoUrl?: string;
  liveUrl?: string;
  imageUrl?: string;
  completedOn?: string;
  courseId?: string;
  attemptId?: string;
  visible: boolean;
  recommendation?: { byId: string; byName: string; note?: string; at: string };
  /** Project review (Stage 10): verified is true only after an authorized instructor approved it. */
  reviewStatus?: 'draft' | 'submitted' | 'under_review' | 'changes_requested' | 'approved';
  verified?: boolean; verifiedById?: string; verifiedByName?: string; verifiedAt?: string;
  batchId?: string; branchId?: string; submittedAt?: string; reviewerId?: string; reviewerName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeSection<T> { items: T[] }

export interface ResumeData {
  fullName: string;
  headline?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  links: { github?: string; linkedin?: string; portfolio?: string };
  education: { institution: string; qualification: string; start?: string; end?: string; score?: string }[];
  skills: string[];
  projects: { title: string; description: string; technologies?: string; url?: string; portfolioEntryId?: string }[];
  experience: { organization: string; role: string; start?: string; end?: string; description?: string; internship?: boolean }[];
  certifications: { name: string; issuer: string; date?: string; certificateId?: string; verifyUrl?: string }[];
  achievements: string[];
}

export interface Resume {
  id: string;
  orgId: string;
  studentId: string;
  name: string;
  template: 'classic' | 'modern' | 'compact';
  data: ResumeData;
  createdAt: string;
  updatedAt: string;
}
