/** Shapes returned by POST /api/student (src/lib/server/student-records.ts). */

export interface MyCourse {
  courseId: string; title: string; description: string; level: string; courseStatus: string; enrollmentStatus: string;
  batchId: string; batchName: string | null; instructors: string[]; startDate: string | null; endDate: string | null;
  totalLessons: number; completedLessons: number; percent: number; lastLessonId: string | null; lastAccessedAt: string | null;
}

export interface UpcomingItem { id: string; courseId: string; courseTitle: string; title: string; kind: string; examType: string | null; closesAt: string | null; opensAt: string | null; status: string }

export interface StudentOverview {
  profile: { name: string; email: string; studentId: string | null };
  courses: MyCourse[];
  current: MyCourse | null;
  lessons: { total: number; completed: number; remaining: number; percent: number };
  attendance: { percent: number | null; classes: number };
  upcoming: UpcomingItem[];
  pendingCount: number;
  recentScores: { id: string; assessmentId: string; courseId: string; title: string; kind: string; score: number; totalMarks: number; percent: number; passed: boolean; evaluatedAt: string }[];
  certificates: { id: string; courseTitle: string; certificateNumber: string; status: string; completedOn: string }[];
  notifications: { id: string; title: string; body: string; link: string | null; read: boolean }[];
}
