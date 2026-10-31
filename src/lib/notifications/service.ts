/**
 * Strynkix LMS — the signed-in user's in-app notifications (milestone G46).
 * Live list of the newest notifications; recipients can only mark them read
 * (firestore.rules), never edit or delete them.
 */

import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { AppNotification } from '@/types/domain';

export const NOTIFICATION_HISTORY = 30;

export function listenToNotifications(
  scope: { orgId: string; userId: string },
  onChange: (items: AppNotification[]) => void,
  onError: (err: Error) => void,
  fs: Firestore = db
): () => void {
  const q = query(collection(fs, 'notifications'), where('orgId', '==', scope.orgId), where('userId', '==', scope.userId), orderBy('createdAt', 'desc'), limit(NOTIFICATION_HISTORY));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppNotification))), onError);
}

export async function markNotificationRead(id: string, fs: Firestore = db): Promise<void> {
  await updateDoc(doc(fs, 'notifications', id), { read: true, readAt: serverTimestamp() });
}

export async function markAllNotificationsRead(ids: string[], fs: Firestore = db): Promise<void> {
  if (!ids.length) return;
  const batch = writeBatch(fs);
  ids.slice(0, 450).forEach((id) => batch.update(doc(fs, 'notifications', id), { read: true, readAt: serverTimestamp() }));
  await batch.commit();
}
