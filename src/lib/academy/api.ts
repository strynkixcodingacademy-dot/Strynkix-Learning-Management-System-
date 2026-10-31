/**
 * Strynkix LMS — browser calls to the academy-operations routes. Identity
 * comes from the ID token; every response is already limited to what the
 * caller may see.
 */

import { postWithIdToken } from '@/lib/api/authed';

export const studentApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/student', body);
export const attendanceApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/attendance', body);
export const certificatesApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/certificates', body);
export const admissionsApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/admissions', body);
export const financeApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/finance', body);
export const expensesApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/expenses', body);
export const reportsApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/reports', body);
export const careerApi = <T>(body: Record<string, unknown>) => postWithIdToken<T>('/api/career', body);
