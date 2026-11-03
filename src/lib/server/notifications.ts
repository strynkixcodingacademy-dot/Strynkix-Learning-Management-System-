/**
 * Strynkix LMS — creating in-app notifications from trusted server code
 * (milestone G46). Always inside the caller's transaction, so a notification
 * exists exactly when the change it describes was committed.
 */

import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { NotificationType } from '@/types/domain';

export function notify(
  tx: Transaction,
  db: Firestore,
  n: { orgId: string; userId: string; type: NotificationType; title: string; body: string; link?: string; sourceId?: string }
): void {
  tx.create(db.collection('notifications').doc(), {
    orgId: n.orgId, userId: n.userId, type: n.type,
    title: n.title.slice(0, 120), body: n.body.slice(0, 500),
    ...(n.link ? { link: n.link } : {}), ...(n.sourceId ? { sourceId: n.sourceId } : {}),
    read: false, createdAt: FieldValue.serverTimestamp(),
  });
}
