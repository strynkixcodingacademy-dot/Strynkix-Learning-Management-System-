import 'server-only';

/**
 * POST /api/admin/academy — edit or (de)activate an academy or a branch,
 * authorized and audited on the server (milestone G35).
 * Body: { action: 'update_org' | 'set_org_status' | 'update_branch' | 'set_branch_status', ... }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { changeAcademy } from '@/lib/server/academy-admin';

export async function POST(request: Request) {
  return handleContentRoute(request, 'admin/academy', (services, token, body) => changeAcademy(services, token, body));
}
