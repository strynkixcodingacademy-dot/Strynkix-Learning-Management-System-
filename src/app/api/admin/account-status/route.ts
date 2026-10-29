import 'server-only';

/**
 * POST /api/admin/account-status — approve, suspend or reactivate an account,
 * audited in the same transaction; suspension also revokes Course Design
 * membership and the user's sessions (Stage C5).
 * Body: { userId, action: 'approve' | 'suspend' | 'reactivate', reason? }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { changeAccountStatus } from '@/lib/server/account-admin';

export async function POST(request: Request) {
  return handleContentRoute(request, 'admin/account-status', (services, token, body) => changeAccountStatus(services, token, body));
}
