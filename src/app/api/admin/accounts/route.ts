import 'server-only';

/**
 * POST /api/admin/accounts — create a staff, student or University Admin
 * account (login + profile + audit entry in one trusted operation).
 * Body: { role, email, password, displayName, orgId, branchId?, courseDesign? }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { createAccount } from '@/lib/server/account-provisioning';

export async function POST(request: Request) {
  return handleContentRoute(request, 'admin/accounts', (services, token, body) => createAccount(services, token, body));
}
