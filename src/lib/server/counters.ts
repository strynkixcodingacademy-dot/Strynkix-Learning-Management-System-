import 'server-only';

/**
 * Strynkix LMS — sequential document numbers (admission, receipt and
 * certificate numbers). The counter is read and advanced inside the caller's
 * transaction, so two concurrent writers can never receive the same number.
 * Call `reserve` before any write in the transaction (Firestore requires all
 * reads first), then `commit` together with the record.
 */

import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';

export interface Reservation { ref: DocumentReference; value: number; exists: boolean }

export async function reserve(tx: Transaction, db: Firestore, counterId: string): Promise<Reservation> {
  const ref = db.doc(`counters/${counterId}`);
  const snap = await tx.get(ref);
  return { ref, value: ((snap.data()?.value as number | undefined) ?? 0) + 1, exists: snap.exists };
}

export function commit(tx: Transaction, r: Reservation, iso: string): void {
  if (r.exists) tx.update(r.ref, { value: r.value, updatedAt: iso });
  else tx.create(r.ref, { value: r.value, updatedAt: iso });
}

/** Branch or academy code for printed numbers: letters and digits only, upper case. */
export const codeOf = (raw: string | undefined, fallback: string) => ((raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || fallback).slice(0, 10);

export const pad = (n: number, width = 4) => String(n).padStart(width, '0');
