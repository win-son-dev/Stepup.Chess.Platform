import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const lb = () => getFirestore().collection('leaderboard');

export async function incrementWin(uid: string): Promise<void> {
  await lb().doc(uid).set({ wins: FieldValue.increment(1) }, { merge: true });
}

export async function incrementLoss(uid: string): Promise<void> {
  await lb().doc(uid).set({ losses: FieldValue.increment(1) }, { merge: true });
}

export async function incrementDraw(uid: string): Promise<void> {
  await lb().doc(uid).set({ draws: FieldValue.increment(1) }, { merge: true });
}
