/**
 * Strynkix Live Books — User Guide content.
 * One source of truth for the User Guide page and the in-app help assistant.
 * Button and field names below match the labels in the product; keep them in
 * sync when a label changes.
 */

import { UserRole } from '@/types/domain';

export type GuideRole = Exclude<UserRole, 'university_admin'>;

export interface GuideTopic {
  id: string;
  title: string;
  /** Roles this task is for. Empty = everyone. */
  roles: GuideRole[];
  category: 'Getting started' | 'Learning' | 'Teaching' | 'Branch operations' | 'Academy administration' | 'Troubleshooting';
  summary: string;
  steps: string[];
  tips?: string[];
  /** Where in the app this happens. */
  link?: { href: string; label: string };
  /** Extra words people use when asking about this topic. */
  keywords: string[];
}

export const ROLE_NAMES: Record<GuideRole, string> = {
  super_admin: 'Super Admin',
  branch_admin: 'Branch Manager',
  instructor: 'Instructor',
  student: 'Student',
};

export const GUIDE: GuideTopic[] = [
  // ---------------------------------------------------------------- Getting started
  {
    id: 'sign-in',
    title: 'Sign in and reset a forgotten password',
    roles: [],
    category: 'Getting started',
    summary: 'Use the email and password your academy gave you. If you forget your password, request a reset link from the sign-in page.',
    steps: [
      'Open the sign-in page and enter your email address and password, then select Sign in.',
      'Forgot it? Select “Forgot password?”, enter your email and select “Send reset link”.',
      'Open the email from Strynkix Live Books and choose a new password, then sign in again.',
    ],
    tips: [
      'For privacy, the reset screen shows the same message whether or not an account exists for that email.',
      'If the link doesn’t arrive within a few minutes, check your spam folder or ask your branch manager.',
    ],
    link: { href: '/login', label: 'Sign-in page' },
    keywords: ['login', 'log in', 'signin', 'password', 'forgot', 'reset', 'credentials', 'cannot login', 'locked'],
  },
  {
    id: 'profile',
    title: 'Update your profile and password',
    roles: [],
    category: 'Getting started',
    summary: 'Your profile shows your role, branch and account status. You can change your display name and phone number, and send yourself a password-reset email.',
    steps: [
      'Select your name at the bottom of the sidebar, or open “My Profile”.',
      'Edit Display name or Phone number and select “Save changes”.',
      'To change your password, select “Email me a reset link” and follow the email.',
    ],
    tips: ['Role, branch and email are managed by your administrators, so they can’t be edited here.'],
    link: { href: '/dashboard/profile', label: 'My Profile' },
    keywords: ['profile', 'name', 'phone', 'account', 'change password', 'settings', 'my details'],
  },
  {
    id: 'navigation',
    title: 'Find your way around',
    roles: [],
    category: 'Getting started',
    summary: 'The sidebar shows only what your role can use. Home always shows what needs your attention today.',
    steps: [
      'Home: today’s plan (students) or today across your batches (staff).',
      'Analytics: progress and performance numbers for your scope, with how each number is calculated.',
      'User Guide: step-by-step instructions for every task, filtered to your role.',
      'Help assistant: the round button at the bottom right answers “how do I…” questions.',
    ],
    link: { href: '/dashboard', label: 'Home' },
    keywords: ['menu', 'sidebar', 'where', 'find', 'navigate', 'home', 'start', 'overview'],
  },

  // ---------------------------------------------------------------- Learning (student)
  {
    id: 'my-day',
    title: 'Follow today’s plan (My Day)',
    roles: ['student'],
    category: 'Learning',
    summary: 'Your instructor plans each day: lessons to read and, usually, one assignment. My Day lists them in order.',
    steps: [
      'Open Home. My Day shows today’s plan for each of your courses.',
      'Work through the steps from top to bottom; the next step is marked “Up next”.',
      'The ring at the top right counts finished steps for today.',
    ],
    tips: ['If nothing is planned today, Home shows the next planned day, and you can keep reading at your own pace.'],
    link: { href: '/dashboard', label: 'Home' },
    keywords: ['today', 'plan', 'schedule', 'what to do', 'targets', 'daily', 'my day', 'tasks'],
  },
  {
    id: 'read-lesson',
    title: 'Read a Live Book lesson and mark it complete',
    roles: ['student'],
    category: 'Learning',
    summary: 'Lessons are interactive pages with code examples, worked examples, quizzes and practice tasks.',
    steps: [
      'Open a lesson from My Day or from your course’s Learning Path.',
      'Read through every section; use the copy button on code panels to copy examples.',
      'Answer the self-check quizzes. They give instant feedback and are not graded.',
      'At the end of the lesson select “Mark completed”. Your progress updates immediately.',
      'Use Previous/Next at the bottom to move through the course.',
    ],
    tips: ['Completion can’t be undone, so mark a lesson complete only when you’ve finished it.'],
    link: { href: '/courses', label: 'My Courses' },
    keywords: ['lesson', 'read', 'complete', 'mark completed', 'finish', 'live book', 'quiz', 'chapter', 'progress'],
  },
  {
    id: 'course-tabs',
    title: 'Use your course page',
    roles: ['student'],
    category: 'Learning',
    summary: 'Each course has tabs for the Learning Path, Schedule, Assignments and About.',
    steps: [
      'Learning Path: every module and lesson with its status.',
      'Schedule: the daily plans your instructor has published.',
      'Assignments: every assignment with its deadline, status and marks.',
      'About: course details and your batch.',
    ],
    link: { href: '/courses', label: 'My Courses' },
    keywords: ['course', 'syllabus', 'curriculum', 'modules', 'schedule tab', 'assignments tab', 'about'],
  },
  {
    id: 'submit-assignment',
    title: 'Submit an assignment',
    roles: ['student'],
    category: 'Learning',
    summary: 'Assignments take a written answer, code, or both, depending on what your instructor asked for.',
    steps: [
      'Open the assignment from My Day or the course’s Assignments tab.',
      'Read the Instructions, the total marks and the deadline.',
      'Write your answer in “Written answer” and/or paste your code in the Code box.',
      'Select “Submit assignment”. You’ll see “Submitted on time” or “Late”, and the work waits for review.',
    ],
    tips: [
      'You can edit and resubmit until your instructor reviews it.',
      'Work submitted after the deadline is accepted but marked Late.',
      'File attachments aren’t supported yet. Share a link in your answer if your instructor asks.',
    ],
    keywords: ['submit', 'assignment', 'homework', 'upload', 'answer', 'code', 'deadline', 'late', 'hand in'],
  },
  {
    id: 'feedback-resubmit',
    title: 'See feedback, marks and fix a returned assignment',
    roles: ['student'],
    category: 'Learning',
    summary: 'When your instructor reviews your work they either give marks or ask you to correct it.',
    steps: [
      'Open the assignment. Graded work shows your marks and the instructor’s feedback.',
      'If your instructor requested a correction, read the feedback, update your answer and select “Resubmit with Corrections”.',
      'Each resubmission is counted as a new attempt.',
    ],
    link: { href: '/dashboard/analytics', label: 'My progress' },
    keywords: ['feedback', 'marks', 'grade', 'score', 'result', 'correction', 'resubmit', 'returned', 'fix', 'redo'],
  },
  {
    id: 'student-progress',
    title: 'Understand your progress numbers',
    roles: ['student'],
    category: 'Learning',
    summary: 'Analytics shows how you’re doing, and each number says how it is calculated.',
    steps: [
      'Learning completion: lessons you’ve completed out of lessons planned up to today.',
      'Assignments submitted: counts only assignments whose deadline has passed.',
      'Average mark: graded work only. Work awaiting review isn’t counted as zero.',
      'Activity: your lesson completions and submissions over the last 14 days.',
    ],
    link: { href: '/dashboard/analytics', label: 'My progress' },
    keywords: ['progress', 'analytics', 'percentage', 'completion', 'average', 'stats', 'report', 'performance'],
  },

  // ---------------------------------------------------------------- Teaching
  {
    id: 'daily-plan',
    title: 'Plan a day for your batch',
    roles: ['instructor', 'branch_admin', 'super_admin'],
    category: 'Teaching',
    summary: 'A daily plan tells students which lessons to finish by when, and can include one assignment.',
    steps: [
      'Open Batches, choose the batch, then “Daily Plans & Assignments”.',
      'Pick the date and select “Create draft plan”.',
      'Add a title and learning objectives, choose lessons, and set “Lessons due by”.',
      'Optionally add the assignment: title, Instructions, Format (written, code or both), Total marks and Deadline.',
      'Select “Publish to students”. Drafts stay invisible to students until you publish.',
    ],
    tips: [
      'Total marks are locked once the assignment is published, so earlier marks stay comparable.',
      'Use Archive to withdraw a plan; it disappears for students without deleting submissions.',
    ],
    link: { href: '/dashboard/batches', label: 'Batches' },
    keywords: ['plan', 'daily plan', 'schedule', 'lesson plan', 'publish', 'create plan', 'assign lessons', 'deadline', 'archive plan', 'assignment create', 'homework'],
  },
  {
    id: 'review-submissions',
    title: 'Review, grade or request a correction',
    roles: ['instructor', 'branch_admin', 'super_admin'],
    category: 'Teaching',
    summary: 'Every submission for a plan’s assignment appears on that plan’s page, with who is late or missing.',
    steps: [
      'Open the plan from Home (“Open plan”) or from the batch’s Daily Plans.',
      'In Submitted work, open a student’s answer and code.',
      'To grade: enter Marks (0 to the total) and Feedback, then select Grade (or “Update grade”).',
      'To return it: write Feedback explaining what to fix and select “Request correction”. The student is asked to resubmit.',
    ],
    tips: ['Home shows “need review” counts for every batch so nothing is missed.'],
    link: { href: '/dashboard', label: 'Home' },
    keywords: ['grade', 'review', 'marks', 'score', 'feedback', 'correction', 'evaluate', 'check', 'submissions', 'mark work'],
  },
  {
    id: 'roster',
    title: 'Check a batch’s roster and progress',
    roles: ['instructor', 'branch_admin', 'super_admin'],
    category: 'Teaching',
    summary: 'The batch page lists every enrolled student with lesson progress and last activity.',
    steps: [
      'Open Batches and choose a batch.',
      '“Roster & Progress” shows each student’s completed lessons and last activity.',
      'For deeper numbers (submission rate, marks, students needing attention) open Analytics.',
    ],
    link: { href: '/dashboard/batches', label: 'Batches' },
    keywords: ['roster', 'students list', 'class list', 'progress', 'attendance', 'who', 'batch students'],
  },
  {
    id: 'course-authoring',
    title: 'Write courses, modules and Live Book lessons',
    roles: ['instructor', 'branch_admin', 'super_admin'],
    category: 'Teaching',
    summary: 'Courses are built from modules, and modules from lessons. Lessons are written in the Block Studio.',
    steps: [
      'Open Course Authoring and select “Create Course”, or open an existing course.',
      'In the Curriculum Builder, use “Add Module”, then “Add Lesson” inside a module.',
      'Select “Edit Blocks” to open the Live Book Block Studio. Add text, headings, code, images, callouts, worked examples, quizzes and practice tasks.',
      'Select “Save Blocks”. Invalid blocks aren’t saved, and the studio tells you exactly what to fix.',
      'Use “Student View” to preview what learners see, then ask the Super Admin to publish it.',
    ],
    tips: [
      'Courses are shared by every branch, so only the Super Admin publishes, unpublishes or archives courses and lessons. You can edit lesson content at any time, and course details while the course is a draft.',
      'Images must be an https:// address or a site path; file upload isn’t available yet.',
    ],
    link: { href: '/dashboard/courses', label: 'Course Authoring' },
    keywords: ['course', 'author', 'create course', 'module', 'lesson', 'content', 'block', 'studio', 'write', 'edit lesson', 'publish course', 'quiz create'],
  },

  // ---------------------------------------------------------------- Branch operations
  {
    id: 'create-batch',
    title: 'Create and manage a batch',
    roles: ['branch_admin', 'super_admin'],
    category: 'Branch operations',
    summary: 'A batch is a group of students taking one course at one branch, with lead instructors and a schedule.',
    steps: [
      'Open Batches & Enrollment and select “Create Batch”.',
      'Choose the course, name and code, start and end dates, and Max Students.',
      'Add lead instructors (up to 5) from your branch, then save.',
      'As the batch runs, use Edit on the batch list to change its status (Upcoming, In progress, Completed), or Archive it when it ends.',
    ],
    tips: [
      'Students can only be enrolled while a batch is Upcoming or In progress.',
      'Max Students is enforced strictly: once the batch is full, further enrollments are refused, even if two people enroll at the same moment.',
      'Students see the lead instructors’ names on their course page.',
    ],
    link: { href: '/dashboard/batches', label: 'Batches & Enrollment' },
    keywords: ['batch', 'create batch', 'cohort', 'class', 'group', 'section', 'max students', 'capacity', 'new batch'],
  },
  {
    id: 'enroll-student',
    title: 'Add a new student or enroll an existing one',
    roles: ['branch_admin', 'super_admin'],
    category: 'Branch operations',
    summary: 'From a batch you can create a student account and enroll them in one step, or enroll a student who already has an account.',
    steps: [
      'Open the batch and go to the enrollment section.',
      'New student: select “Create & Enroll Student”, enter Full Name and Email Address, use “Generate Strong Password”, then create.',
      'Use “Copy Credentials to Share” and send them to the student privately.',
      'Existing student: choose them in “Student to enroll” and enroll them.',
      'Roster actions: Complete, Deactivate, Withdraw, and Reactivate (while the batch is open).',
    ],
    tips: [
      'Only active students of the same branch appear in the list.',
      'Each student can be in one batch per course.',
      'Ask new students to change their password with the reset link after first sign-in.',
    ],
    link: { href: '/dashboard/batches', label: 'Batches & Enrollment' },
    keywords: ['enroll', 'add student', 'new student', 'register', 'admission', 'admit', 'withdraw', 'remove student', 'credentials', 'create student'],
  },
  {
    id: 'add-instructor',
    title: 'Add an instructor to your branch',
    roles: ['branch_admin', 'super_admin'],
    category: 'Branch operations',
    summary: 'Create an instructor account from a batch, or assign an existing instructor through the batch’s Edit dialog.',
    steps: [
      'New instructor: open the batch, select “Add Lead Instructor”, enter Full Name and Email Address, and generate a password.',
      'Use “Copy Credentials to Share” and send them privately. The instructor will see the batch under My Batches after signing in.',
      'Existing instructor: on Batches & Enrollment select Edit on the batch and tick them under Lead Instructors.',
    ],
    tips: ['Removing an instructor from a batch removes their access to that batch’s plans and submissions immediately.'],
    link: { href: '/dashboard/batches', label: 'Batches & Enrollment' },
    keywords: ['instructor', 'teacher', 'trainer', 'faculty', 'add instructor', 'staff', 'assign teacher', 'mentor'],
  },
  {
    id: 'people',
    title: 'Manage people: approve, suspend or reactivate accounts',
    roles: ['branch_admin', 'super_admin'],
    category: 'Branch operations',
    summary: 'People lists the students and instructors in your scope with their status.',
    steps: [
      'Open People. Filter by role or status, or search by name or email.',
      'Pending sign-ups appear as “Pending”. Select Approve to activate them.',
      'Select Suspend to block an account immediately; Reactivate restores it.',
    ],
    tips: ['Suspending keeps all learning history. Accounts are never deleted from here.'],
    link: { href: '/dashboard/people', label: 'People' },
    keywords: ['people', 'users', 'students list', 'approve', 'activate', 'pending', 'suspend', 'block', 'deactivate', 'reactivate', 'accounts'],
  },
  {
    id: 'branch-analytics',
    title: 'Monitor branch performance',
    roles: ['branch_admin', 'super_admin', 'instructor'],
    category: 'Branch operations',
    summary: 'Analytics combines every batch in your scope: completion, submissions, marks, review backlog and students needing attention.',
    steps: [
      'Open Analytics.',
      'The top tiles show totals. Each one states exactly what it counts.',
      'The activity chart shows lesson completions and submissions per day for the last 14 days.',
      '“Needs attention” lists students with missed deadlines, overdue lessons or low marks, and why.',
      'The batch table compares batches side by side; select a batch to open it.',
    ],
    link: { href: '/dashboard/analytics', label: 'Analytics' },
    keywords: ['analytics', 'report', 'performance', 'dashboard', 'statistics', 'metrics', 'at risk', 'kpi', 'insights', 'numbers'],
  },

  // ---------------------------------------------------------------- Academy administration
  {
    id: 'create-branch',
    title: 'Open a new branch and add its manager',
    roles: ['super_admin'],
    category: 'Academy administration',
    summary: 'Branches are your academy’s campuses or franchises. Each branch has its own managers, instructors, students and batches.',
    steps: [
      'Open Branches and select “Create Branch”.',
      'Enter the Branch ID, name, code, City, State and Country (or tick Remote Virtual Campus).',
      'On the branch card select “Add Branch Manager”, enter their details and generate a password.',
      'Copy the credentials and share them privately. The manager can then run their branch.',
    ],
    tips: ['A branch manager only ever sees and changes their own branch’s data.'],
    link: { href: '/dashboard/branches', label: 'Branches' },
    keywords: ['branch', 'franchise', 'campus', 'centre', 'center', 'location', 'new branch', 'manager', 'branch manager', 'branch admin'],
  },
  {
    id: 'publish-courses',
    title: 'Govern the course catalogue',
    roles: ['super_admin'],
    category: 'Academy administration',
    summary: 'Courses are shared by every branch, so only the Super Admin publishes, unpublishes, archives or deletes them and their lessons.',
    steps: [
      'Open Course Authoring to see every course with its status.',
      'Use the status filter to review Drafts written by instructors and branch managers.',
      'Open a course and select “Publish Course”, then publish its lessons in the Curriculum Builder.',
      'Prefer Archive over deletion: archiving keeps student history intact.',
    ],
    link: { href: '/dashboard/courses', label: 'Course Authoring' },
    keywords: ['catalogue', 'catalog', 'publish', 'unpublish', 'archive course', 'courses all branches', 'governance'],
  },
  {
    id: 'organizations',
    title: 'Manage the organization',
    roles: ['super_admin'],
    category: 'Academy administration',
    summary: 'The organization is the academy itself. Its settings apply to every branch.',
    steps: [
      'Open Organizations to see the academy record and create additional organizations if needed.',
      'Set the academy time zone when creating an organization. It decides what “today” means for daily plans, deadlines and analytics on every device.',
    ],
    link: { href: '/dashboard/organizations', label: 'Organizations' },
    keywords: ['organization', 'organisation', 'academy', 'tenant', 'company', 'time zone', 'timezone'],
  },

  // ---------------------------------------------------------------- Troubleshooting
  {
    id: 'trouble-course-missing',
    title: 'A course or lesson isn’t showing',
    roles: [],
    category: 'Troubleshooting',
    summary: 'Students only see published courses they are actively enrolled in, and only published lessons.',
    steps: [
      'Students: check with your branch manager that you’re enrolled in an active batch for the course.',
      'Staff: make sure the course and lesson are Published, not Draft.',
      'Daily plans are only visible to students once they’re published.',
    ],
    keywords: ['missing', 'not showing', 'cannot see', 'can’t see', 'empty', 'no course', 'not enrolled', 'unavailable', 'hidden'],
  },
  {
    id: 'trouble-student-list',
    title: 'A student doesn’t appear when enrolling',
    roles: ['branch_admin', 'super_admin'],
    category: 'Troubleshooting',
    summary: 'Only active students of the batch’s branch who aren’t already in a batch for that course can be enrolled.',
    steps: [
      'Check the student’s status in People. Approve them if they’re Pending.',
      'Check the student belongs to the same branch as the batch.',
      'If the batch says it’s full, raise Max Students or use another batch.',
    ],
    link: { href: '/dashboard/people', label: 'People' },
    keywords: ['student not found', 'not in list', 'cannot enroll', 'batch full', 'capacity', 'enrol error'],
  },
  {
    id: 'trouble-account',
    title: 'My account is pending or suspended',
    roles: [],
    category: 'Troubleshooting',
    summary: 'A pending account is waiting for approval; a suspended account has been paused by an administrator.',
    steps: [
      'Contact your branch manager (students and instructors) or the academy’s Super Admin (branch managers).',
      'Once approved or reactivated, sign out and sign in again.',
    ],
    keywords: ['pending', 'suspended', 'blocked', 'not approved', 'no access', 'access denied', 'not available to you'],
  },
];

export function topicsForRole(role: UserRole | undefined): GuideTopic[] {
  if (!role || role === 'university_admin') return GUIDE.filter((t) => t.roles.length === 0);
  return GUIDE.filter((t) => t.roles.length === 0 || t.roles.includes(role));
}
