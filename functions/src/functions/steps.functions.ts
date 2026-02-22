import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { submitStepDeltaConfig } from '../config/instances';
import { getConfigAsync, CONFIG_KEYS } from '../config/config.service';
import { atomicIncrementStepBalance } from '../repositories/step.repository';

/**
 * Called by the Flutter client whenever the pedometer earns new steps during
 * an active game. Steps only accumulate from game-start to game-end.
 *
 * Atomically increments the per-game RTDB balance at
 * /games/{gameId}/steps/{uid}/balance. The balance is written ONLY here —
 * never directly by the client.
 *
 * Input:  { gameId: string, delta: number }
 * Output: { newBalance: number }
 */
export const submitStepDelta = onCall(submitStepDeltaConfig, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  const uid = request.auth.uid;

  const { gameId, delta } = request.data as {
    gameId: string;
    delta: number;
  };

  if (!gameId) throw new HttpsError('invalid-argument', 'gameId is required');
  if (!Number.isInteger(delta) || delta <= 0) {
    throw new HttpsError('invalid-argument', 'delta must be a positive integer');
  }

  const gameSnap = await admin.database().ref(`games/${gameId}`).get();
  if (!gameSnap.exists()) throw new HttpsError('not-found', `Game ${gameId} not found`);

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

  const newBalance = await atomicIncrementStepBalance(gameId, uid, delta);

  return { newBalance };
});
