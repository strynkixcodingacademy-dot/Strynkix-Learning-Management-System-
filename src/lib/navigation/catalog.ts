/**
 * Strynkix Live Books — the navigation catalog. Every page a role can open is a
 * feature in one category; the rail shows categories, a category opens its hub
 * of feature tiles, and search matches feature names, descriptions and
 * keywords. Navigation only shows the way; every route and API call authorizes
 * on its own.
 */

import type { UserRole } from '@/types/domain';
import type { Tone } from '@/components/ui/tones';
import {
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  FileText,
  Gauge,
  GitBranch,
  GraduationCap,
  HelpCircle,
  IndianRupee,
  LayoutDashboard,
  Library,
  LifeBuoy,
  MessageSquareText,
  PenTool,
  Receipt,
  Rocket,
  ScrollText,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  UsersRound,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

export type CategoryId =
  | 'learn' | 'progress' | 'campus' | 'career' | 'fees'
  | 'teaching' | 'content' | 'people' | 'money' | 'insights';

export interface Category {
  id: CategoryId;
  name: string;
  description: string;
  icon: LucideIcon;
  tone: Tone;
}

export interface Feature {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  /** Absent for account pages (profile, guide) that live in the avatar menu. */
  category?: CategoryId;
  description: string;
  /** Everyday words people search with ("scheduler", "fees"). */
  keywords?: string[];
}

const CONTENT: UserRole[] = ['content_lead', 'content_designer'];
const ALL: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor', 'student', ...CONTENT];
const STAFF: UserRole[] = ['super_admin', 'university_admin', 'branch_admin', 'instructor'];
const MANAGERS: UserRole[] = ['super_admin', 'university_admin', 'branch_admin'];
// Staff author drafts; Course Design members author in-scope drafts (rules enforce scope).
const AUTHORS: UserRole[] = [...STAFF, ...CONTENT];

export const CATEGORIES: Category[] = [
  { id: 'learn', name: 'Learn', description: 'Your courses, Live Books, assignments and doubts', icon: GraduationCap, tone: 'brand' },
  { id: 'progress', name: 'Progress', description: 'Scores, attendance, achievements and certificates', icon: TrendingUp, tone: 'success' },
  { id: 'campus', name: 'Campus', description: 'Events, activities and feedback', icon: CalendarDays, tone: 'teal' },
  { id: 'career', name: 'Career', description: 'Projects, portfolio and resume', icon: Rocket, tone: 'lavender' },
  { id: 'fees', name: 'Fees', description: 'What you have paid, what is due and receipts', icon: IndianRupee, tone: 'warning' },
  { id: 'teaching', name: 'Teaching', description: 'Batches, daily plans, attendance and reviewing work', icon: Users, tone: 'brand' },
  { id: 'content', name: 'Content', description: 'Courses, Live Books and certificates', icon: Library, tone: 'teal' },
  { id: 'people', name: 'People', description: 'Admissions, accounts, branches and academies', icon: UsersRound, tone: 'lavender' },
  { id: 'money', name: 'Money', description: 'Fees, expenses and financial reports', icon: IndianRupee, tone: 'warning' },
  { id: 'insights', name: 'Insights', description: 'Command Centre, analytics, engagement and audit', icon: BarChart3, tone: 'coral' },
];

export const FEATURES: Feature[] = [
  // Student
  { name: 'My Courses', href: '/dashboard/my-courses', icon: BookOpen, roles: ['student'], category: 'learn', description: 'Courses you are enrolled in and where you left off', keywords: ['enrolled', 'continue', 'resume learning'] },
  { name: 'Live Books', href: '/courses', icon: Library, roles: ['student'], category: 'learn', description: 'Read lessons, watch videos and take quizzes', keywords: ['lessons', 'livebooks', 'reader', 'videos', 'quiz', 'schedule', 'syllabus'] },
  { name: 'Assignments & Exams', href: '/dashboard/assessments', icon: ClipboardList, roles: ['student'], category: 'learn', description: 'Tests and assignments to take or submit', keywords: ['assessment', 'exam', 'test', 'homework', 'submit'] },
  { name: 'Doubts', href: '/dashboard/doubts', icon: HelpCircle, roles: ['student'], category: 'learn', description: 'Ask your instructors a question', keywords: ['question', 'ask', 'query', 'help'] },
  { name: 'Dashboard', href: '/dashboard/overview', icon: LayoutDashboard, roles: ['student'], category: 'progress', description: 'Everything about your learning on one page', keywords: ['overview', 'summary'] },
  { name: 'My Progress', href: '/dashboard/analytics', icon: BarChart3, roles: ['student'], category: 'progress', description: 'How far you have come in each course', keywords: ['analytics', 'stats', 'completion'] },
  { name: 'My Scores', href: '/dashboard/scores', icon: Trophy, roles: ['student'], category: 'progress', description: 'Marks for your tests and assignments', keywords: ['marks', 'grades', 'results'] },
  { name: 'Attendance', href: '/dashboard/attendance', icon: CalendarCheck, roles: ['student'], category: 'progress', description: 'Days you were present or absent', keywords: ['present', 'absent'] },
  { name: 'Achievements', href: '/dashboard/achievements', icon: Sparkles, roles: ['student'], category: 'progress', description: 'Badges and milestones you have earned', keywords: ['badges', 'rewards', 'streak'] },
  { name: 'Certificates', href: '/dashboard/certificates', icon: Award, roles: ['student'], category: 'progress', description: 'Certificates for courses you completed', keywords: ['certificate', 'download'] },
  { name: 'Activities', href: '/dashboard/activities', icon: CalendarDays, roles: ['student'], category: 'campus', description: 'Workshops, hackathons and events to join', keywords: ['events', 'workshop', 'hackathon', 'register'] },
  { name: 'Feedback', href: '/dashboard/feedback', icon: MessageSquareText, roles: ['student'], category: 'campus', description: 'Tell the academy what works and what does not', keywords: ['complaint', 'suggestion', 'survey'] },
  { name: 'Projects & Portfolio', href: '/dashboard/portfolio', icon: Briefcase, roles: ['student'], category: 'career', description: 'Your projects and public portfolio', keywords: ['project', 'github', 'showcase'] },
  { name: 'Resume', href: '/dashboard/resume', icon: FileText, roles: ['student'], category: 'career', description: 'Build and download your resume', keywords: ['cv', 'job', 'placement'] },
  { name: 'My Fees', href: '/dashboard/fees', icon: IndianRupee, roles: ['student'], category: 'fees', description: 'Your fee balance, installments and receipts', keywords: ['fees', 'payment', 'receipt', 'installment', 'due'] },

  // Staff — Teaching
  { name: 'My Teaching', href: '/dashboard/teaching', icon: Gauge, roles: ['instructor'], category: 'teaching', description: 'Your batches, plans and work to review at a glance', keywords: ['today', 'overview'] },
  { name: 'My Batches', href: '/dashboard/batches', icon: Users, roles: ['instructor'], category: 'teaching', description: 'Batches you teach, their daily plans and students', keywords: ['batch', 'class', 'daily plans', 'schedule', 'scheduler', 'timetable', 'plan today'] },
  { name: 'Batches & Enrollment', href: '/dashboard/batches', icon: Users, roles: MANAGERS, category: 'teaching', description: 'Create batches, enrol students and plan each day', keywords: ['batch', 'class', 'enrol', 'enroll', 'daily plans', 'schedule', 'scheduler', 'timetable', 'plan today'] },
  { name: 'Timetable approvals', href: '/dashboard/admin/timetables', icon: CalendarCheck, roles: ['super_admin'], category: 'teaching', description: 'Approve or send back submitted weekly timetables', keywords: ['timetable', 'weekly', 'schedule', 'scheduler', 'approve', 'approval'] },
  { name: 'Attendance', href: '/dashboard/attendance', icon: CalendarCheck, roles: STAFF, category: 'teaching', description: 'Take and review attendance for each batch', keywords: ['present', 'absent', 'roll call'] },
  { name: 'Evaluate', href: '/dashboard/assessments', icon: ClipboardList, roles: STAFF, category: 'teaching', description: 'Assessments, exams and grading', keywords: ['assessment', 'exam', 'test', 'quiz', 'grading', 'marks', 'review work', 'submissions'] },
  { name: 'Doubts', href: '/dashboard/doubts', icon: HelpCircle, roles: STAFF, category: 'teaching', description: 'Answer students’ questions', keywords: ['question', 'query', 'help'] },
  { name: 'Project reviews', href: '/dashboard/projects/review', icon: Briefcase, roles: STAFF, category: 'teaching', description: 'Review and approve student projects', keywords: ['project', 'portfolio', 'approve'] },
  { name: 'Activities', href: '/dashboard/activities', icon: CalendarDays, roles: STAFF, category: 'teaching', description: 'Workshops, hackathons and events', keywords: ['events', 'workshop', 'hackathon'] },
  { name: 'Feedback', href: '/dashboard/feedback', icon: MessageSquareText, roles: STAFF, category: 'teaching', description: 'Read and respond to student feedback', keywords: ['complaint', 'suggestion', 'survey'] },

  // Content
  { name: 'Course Authoring', href: '/dashboard/courses', icon: PenTool, roles: AUTHORS, category: 'content', description: 'Write courses, modules, lessons and quizzes', keywords: ['course', 'lesson', 'module', 'author', 'edit', 'block studio', 'curriculum'] },
  { name: 'Live Books', href: '/courses', icon: BookOpen, roles: [...STAFF, ...CONTENT], category: 'content', description: 'Read published courses as students see them', keywords: ['lessons', 'livebooks', 'reader', 'preview'] },
  { name: 'Certificates', href: '/dashboard/certificates', icon: Award, roles: STAFF, category: 'content', description: 'Issue and verify course certificates', keywords: ['certificate', 'issue', 'verify'] },

  // People
  { name: 'Admissions', href: '/dashboard/admissions', icon: UserPlus, roles: MANAGERS, category: 'people', description: 'Enquiries, admissions and new students', keywords: ['admission', 'enquiry', 'lead', 'new student', 'onboard'] },
  { name: 'People', href: '/dashboard/people', icon: UsersRound, roles: MANAGERS, category: 'people', description: 'Accounts, roles and approvals', keywords: ['users', 'accounts', 'students', 'staff', 'instructors', 'roles', 'approve'] },
  { name: 'Branches', href: '/dashboard/branches', icon: GitBranch, roles: ['super_admin', 'university_admin'], category: 'people', description: 'The academy’s branches and their managers', keywords: ['branch', 'centre', 'campus', 'location'] },
  { name: 'Organizations', href: '/dashboard/organizations', icon: Building2, roles: ['super_admin'], category: 'people', description: 'Academies on the platform and their admins', keywords: ['academy', 'university', 'organisation', 'tenant'] },

  // Money
  { name: 'Finance', href: '/dashboard/finance', icon: IndianRupee, roles: MANAGERS, category: 'money', description: 'Fee accounts, payments, receipts and dues', keywords: ['fees', 'payment', 'receipt', 'installment', 'due', 'ledger', 'collection'] },
  { name: 'Expenses', href: '/dashboard/expenses', icon: Receipt, roles: MANAGERS, category: 'money', description: 'Record and approve branch expenses', keywords: ['expense', 'spend', 'bills', 'salary', 'rent'] },
  { name: 'Reports', href: '/dashboard/reports', icon: FileBarChart, roles: MANAGERS, category: 'money', description: 'Financial and academic reports to export', keywords: ['report', 'export', 'csv', 'pdf'] },

  // Insights
  { name: 'Command Centre', href: '/dashboard/command', icon: Gauge, roles: ['super_admin'], category: 'insights', description: 'The whole platform: academies, branches, money and learning', keywords: ['command', 'overview', 'global', 'reporting', 'snapshots'] },
  { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, roles: STAFF, category: 'insights', description: 'Learning progress and performance across batches', keywords: ['stats', 'charts', 'performance', 'progress'] },
  { name: 'Engagement', href: '/dashboard/engagement', icon: Sparkles, roles: MANAGERS, category: 'insights', description: 'Announcements, participation and student engagement', keywords: ['announcement', 'notice', 'participation'] },
  { name: 'Audit log', href: '/dashboard/audit', icon: ScrollText, roles: ['super_admin', 'university_admin'], category: 'insights', description: 'Who changed what, and when', keywords: ['audit', 'history', 'log', 'changes'] },

  // Account (avatar menu and search)
  { name: 'My Profile', href: '/dashboard/profile', icon: UserRound, roles: ALL, description: 'Your details, password, notifications and appearance', keywords: ['profile', 'password', 'account', 'settings', 'preferences', 'notifications', 'theme', 'dark mode', 'light mode', 'appearance'] },
  { name: 'User Guide', href: '/dashboard/guide', icon: LifeBuoy, roles: ALL, description: 'How to use Live Books', keywords: ['help', 'guide', 'manual', 'how to'] },
];

export const HOME_HREF = '/dashboard';

export function hubHref(id: CategoryId) {
  return `/dashboard/hub/${id}`;
}

export function isActivePath(pathname: string, href: string) {
  if (href === HOME_HREF) return pathname === HOME_HREF;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function featuresFor(role: UserRole | undefined): Feature[] {
  return role ? FEATURES.filter((f) => f.roles.includes(role)) : [];
}

export interface CategoryGroup {
  category: Category;
  features: Feature[];
  /** A one-feature category opens that page directly. */
  href: string;
}

export function categoriesFor(role: UserRole | undefined): CategoryGroup[] {
  const features = featuresFor(role);
  return CATEGORIES.flatMap((category) => {
    const own = features.filter((f) => f.category === category.id);
    if (!own.length) return [];
    return [{ category, features: own, href: own.length === 1 ? own[0].href : hubHref(category.id) }];
  });
}

/** The feature whose page is showing (longest matching href wins). */
export function currentFeature(pathname: string, role: UserRole | undefined): Feature | undefined {
  return [...featuresFor(role)].sort((a, b) => b.href.length - a.href.length).find((f) => isActivePath(pathname, f.href));
}

/** The category the current page belongs to: its hub, or one of its features. */
export function activeCategory(pathname: string, role: UserRole | undefined): CategoryId | undefined {
  const hub = pathname.match(/^\/dashboard\/hub\/([a-z]+)/)?.[1];
  if (hub) return CATEGORIES.find((c) => c.id === hub)?.id;
  return currentFeature(pathname, role)?.category;
}

/** The category a link belongs to, for routing home-tile badges to their category. */
export function categoryOfHref(href: string, role: UserRole | undefined): CategoryId | undefined {
  return currentFeature(href.split('?')[0], role)?.category;
}

export function normalize(text: string) {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9₹]+/g, ' ').trim();
}

/**
 * Scores how well a query matches: every query word must appear somewhere;
 * matches in the name rank above matches in keywords or the description.
 * Returns 0 for no match.
 */
export function matchScore(query: string, name: string, extra: string[] = []): number {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return 0;
  const n = normalize(name);
  const rest = normalize(extra.join(' '));
  let score = 0;
  for (const w of words) {
    if (n.startsWith(w)) score += 6;
    else if (n.split(' ').some((part) => part.startsWith(w))) score += 4;
    else if (n.includes(w)) score += 3;
    else if (rest.split(' ').some((part) => part.startsWith(w))) score += 2;
    else if (rest.includes(w)) score += 1;
    else return 0;
  }
  return score;
}

export function searchFeatures(query: string, role: UserRole | undefined, limit = 6): Feature[] {
  // The same page can appear twice for a role only by href; keep the first.
  const seen = new Set<string>();
  return featuresFor(role)
    .map((f) => ({ f, s: matchScore(query, f.name, [...(f.keywords ?? []), f.description, CATEGORIES.find((c) => c.id === f.category)?.name ?? '']) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name))
    .flatMap(({ f }) => (seen.has(f.href) ? [] : (seen.add(f.href), [f])))
    .slice(0, limit);
}
