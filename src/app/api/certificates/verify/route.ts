import 'server-only';

/**
 * GET /api/certificates/verify?code=… — public certificate check. Returns only
 * what is printed on the certificate (no sign-in required).
 */

import { AdminConfigError, getAdminServices } from '@/lib/server/firebase-admin';
import { verifyCertificate } from '@/lib/server/certificates';
import { ReviewError } from '@/lib/review/workflow';

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code') ?? '';
  const headers = { 'Cache-Control': 'no-store' };
  try {
    return Response.json(await verifyCertificate(getAdminServices().db, code), { headers });
  } catch (err) {
    if (err instanceof ReviewError) return Response.json({ error: err.code, message: err.message }, { status: err.status, headers });
    console.error('[certificates/verify]', err instanceof AdminConfigError ? err.message : err);
    return Response.json({ error: 'unavailable', message: 'Verification is unavailable right now.' }, { status: 503, headers });
  }
}
