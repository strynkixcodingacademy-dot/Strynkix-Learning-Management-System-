import 'server-only';

/**
 * POST /api/admin/account-profile — change a user's role, move them to another
 * branch or correct their sign-in email, authorized and audited on the server
 * (milestone G40). Body: { action: 'change_role' | 'move_branch' | 'change_email', userId, ... }
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { correctAccount } from '@/lib/server/account-profile-admin';

export async function POST(request: Request) {
  return handleContentRoute(request, 'admin/account-profile', (services, token, body) => correctAccount(services, token, body));
}
