import * as admin from 'firebase-admin';

export async function getStepBalance(gameId: string, uid: string): Promise<number> {
  const snap = await admin.database().ref(`games/${gameId}/steps/${uid}/balance`).get();
  return (snap.val() as number | null) ?? 0;
}

export async function setStepBalance(gameId: string, uid: string, balance: number): Promise<void> {
  await admin.database().ref(`games/${gameId}/steps/${uid}/balance`).set(balance);
}

/** Atomically increments the step balance and returns the new value. */
export async function atomicIncrementStepBalance(
  gameId: string,
  uid: string,
  delta: number,
): Promise<number> {
  const ref = admin.database().ref(`games/${gameId}/steps/${uid}/balance`);
  const result = await ref.transaction((current: number | null) => (current ?? 0) + delta);
  return result.snapshot.val() as number;
}
