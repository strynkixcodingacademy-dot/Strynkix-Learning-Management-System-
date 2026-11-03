import 'server-only';

/**
 * POST /api/expenses — expense categories, expenses and recurring schedules (src/lib/server/expenses.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleExpenses } from '@/lib/server/expenses';

export async function POST(request: Request) {
  return handleContentRoute(request, 'expenses', (services, token, body) => handleExpenses(services, token, body));
}
