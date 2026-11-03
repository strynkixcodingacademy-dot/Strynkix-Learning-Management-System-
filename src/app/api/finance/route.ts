import 'server-only';

/**
 * POST /api/finance — course pricing, fee accounts and the fee ledger (src/lib/server/finance.ts).
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { handleFinance } from '@/lib/server/finance';

export async function POST(request: Request) {
  return handleContentRoute(request, 'finance', (services, token, body) => handleFinance(services, token, body));
}
