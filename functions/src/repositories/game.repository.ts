import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { OnlineGame } from '../types';

export async function getGame(gameId: string): Promise<OnlineGame> {
  const snapshot = await admin.database().ref(`games/${gameId}`).get();
  if (!snapshot.exists()) {
    throw new HttpsError('not-found', `Game ${gameId} not found`);
  }
  return snapshot.val() as OnlineGame;
}

/** Writes initial game record to RTDB, Firestore, and sets the creator's active game pointer. */
export async function createGameRecord(
  gameId: string,
  game: OnlineGame,
  creatorUid: string,
): Promise<void> {
  await Promise.all([
    admin.database().ref(`games/${gameId}`).set(game),
    admin.firestore().collection('games').doc(gameId).set(game),
    admin.database().ref(`userActiveGame/${creatorUid}`).set(gameId),
  ]);
}

/** Updates game state in both RTDB and Firestore (used for status changes). */
export async function updateGameState(
  gameId: string,
  updates: Partial<OnlineGame>,
): Promise<void> {
  await Promise.all([
    admin.database().ref(`games/${gameId}`).update(updates),
    admin.firestore().collection('games').doc(gameId).update(updates as Record<string, unknown>),
  ]);
}

/** Updates only RTDB — used on every move (hot path; Firestore sync not needed per move). */
export async function updateGameMove(
  gameId: string,
  fen: string,
  moveHistory: string[],
): Promise<void> {
  await admin.database().ref(`games/${gameId}`).update({ fen, moveHistory });
}

export async function setUserActiveGame(uid: string, gameId: string): Promise<void> {
  await admin.database().ref(`userActiveGame/${uid}`).set(gameId);
}

export async function clearUserActiveGames(uids: string[]): Promise<void> {
  const updates: Record<string, null> = {};
  for (const uid of uids) {
    updates[`userActiveGame/${uid}`] = null;
  }
  await admin.database().ref().update(updates);
}

export async function assertNoActiveGame(uid: string): Promise<void> {
  const snap = await admin.database().ref(`userActiveGame/${uid}`).get();
  if (snap.exists()) {
    throw new HttpsError(
      'failed-precondition',
      'You already have an active game. Finish or resign it first.',
    );
  }
}
