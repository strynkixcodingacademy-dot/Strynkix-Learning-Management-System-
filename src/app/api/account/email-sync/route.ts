import 'server-only';

/**
 * POST /api/account/email-sync — after a user verifies a new sign-in email,
 * copy it from Firebase Auth onto their profile (milestone G06). Body: {}.
 * Header: Authorization: Bearer <Firebase ID token>
 */

import { handleContentRoute } from '@/lib/server/content-route';
import { syncOwnEmail } from '@/lib/server/account-profile-admin';

export async function POST(request: Request) {
  return handleContentRoute(request, 'account/email-sync', (services, token) => syncOwnEmail(services, token));
}
