import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { StepTransactionData } from './types';
import { submitStepDeltaConfig } from './config/instances';
import { getConfigAsync, CONFIG_KEYS } from './config/config.service';

/**
 * submitStepDelta
 *
 * Called by the Flutter client whenever the pedometer earns new steps
 * during an active game. Steps only accumulate from game-start to game-end.
 * Caller identity comes from the Firebase Auth bearer token — never from
 * the request body.
 *
 * Atomically increments the per-game RTDB balance and writes an earn
 * transaction to Firestore. The balance at
 * /games/{gameId}/steps/{uid}/balance is written ONLY here, never directly
 * by the client.
 *
 * Input:  { gameId: string, delta: number, source?: string }
 * Output: { newBalance: number }
 */
export const submitStepDelta = onCall(submitStepDeltaConfig, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  const uid = request.auth.uid;

  const { gameId, delta, source = 'pedometer' } = request.data as {
    gameId: string;
    delta: number;
    source?: string;
  };

  if (!gameId) {
    throw new HttpsError('invalid-argument', 'gameId is required');
  }

  if (!Number.isInteger(delta) || delta <= 0) {
    throw new HttpsError('invalid-argument', 'delta must be a positive integer');
  }

  // Verify caller is an active player in this game
  const gameSnap = await admin.database().ref(`games/${gameId}`).get();
  if (!gameSnap.exists()) {
    throw new HttpsError('not-found', `Game ${gameId} not found`);
  }
  const game = gameSnap.val() as {
    whitePlayerId: string;
    blackPlayerId: string | null;
    status: string;
  };

  if (uid !== game.whitePlayerId && uid !== game.blackPlayerId) {
    throw new HttpsError('permission-denied', 'You are not a player in this game');
  }
  if (game.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Game is not active');
  }

  // Remote Config anti-cheat cap
  const config = await getConfigAsync();
  const maxDelta = config.getNumber(CONFIG_KEYS.MAX_STEP_DELTA_PER_CALL);
  if (delta > maxDelta) {
    throw new HttpsError(
      'invalid-argument',
      `delta exceeds maximum allowed per call (${maxDelta})`,
    );
  }

  // Per-game balance — atomic increment
  const balanceRef = admin.database().ref(`games/${gameId}/steps/${uid}/balance`);

  const result = await balanceRef.transaction((current: number | null) => {
    return (current ?? 0) + delta;
  });
  const newBalance = result.snapshot.val() as number;

  const tx: StepTransactionData = {
    amount: delta,
    balanceAfter: newBalance,
    source: source as StepTransactionData['source'],
    timestamp: new Date().toISOString(),
    gameId,
  };

  await admin
    .firestore()
    .collection('stepTransactions')
    .doc(uid)
    .collection('transactions')
    .add(tx);

  return { newBalance };
});
