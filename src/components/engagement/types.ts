/** Shapes returned by POST /api/engagement (my_engagement). */
export interface MyEngagement {
  today: string;
  streak: { current: number; longest: number; totalDays: number; learnedToday: boolean };
  weekly: { weekStart: string; goal: number; done: number; met: boolean };
  history: { weekStart: string; days: number }[];
  thisMonth: MonthSummary; lastMonth: MonthSummary;
  stats: { lessonsCompleted: number; assignmentsSubmitted: number; assessmentsCompleted: number; projectsApproved: number; coursesCompleted: number; longestStreak: number; perfectAttendanceMonths: string[] };
  achievements: { id: string; key: string; title: string; description: string; awardedAt: string; evidence: { metric: string; value: number; threshold: number; period?: string } }[];
  newlyAwarded: string[]; available: number;
  deadlines: { id: string; courseId: string; title: string; kind: string; closesAt: string }[];
  feedback: { source: string; title: string; feedback: string; at: string; link: string }[];
  attendance: { percent: number | null; classes: number };
  doubts: { id: string; title: string; status: string }[];
  activities: { activityId: string; title: string; startsAt: string }[];
}
export interface MonthSummary { month: string; learningDays: number; lessons: number; assessments: number; assignments: number; classesAttended: number }
export const DOUBT_STATUS_LABEL: Record<string, string> = { open: 'Open', assigned: 'Assigned', in_progress: 'In progress', waiting_for_student: 'Waiting for student', resolved: 'Resolved' };
