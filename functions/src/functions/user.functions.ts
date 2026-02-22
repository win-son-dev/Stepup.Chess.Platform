import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { beforeUserCreated } from 'firebase-functions/v2/identity';
import {
  initUserStepBalance,
  createUserProfile,
  createLeaderboardEntry,
  syncDisplayName,
} from '../repositories/user.repository';
import { randomAvatarColor } from '../services/user.service';

/**
 * Triggered by Firebase Auth on new account creation.
 * Bootstraps all records the client expects to exist so streams never return null:
 *
 *   RTDB  /steps/{uid}/balance       → 0
 *   Firestore users/{uid}            → UserProfile
 *   Firestore leaderboard/{uid}      → PlayerStats (all zeros)
 */
export const onUserCreated = beforeUserCreated(async (event) => {
  if (!event.data) return;
  const uid = event.data.uid;
  const displayName = event.data.displayName ?? event.data.email?.split('@')[0] ?? 'Player';

  await Promise.all([
    initUserStepBalance(uid),
    createUserProfile(uid, displayName, randomAvatarColor()),
    createLeaderboardEntry(uid, displayName),
  ]);
});

/**
 * Updates displayName in both users/ and leaderboard/ atomically.
 * Caller identity comes from the bearer token — never from request body.
 *
 * Input:  { displayName: string }
 * Output: { success: true }
 */
export const updateDisplayName = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  const uid = request.auth.uid;

  const { displayName } = request.data as { displayName: string };

  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'displayName is required');
  }

  await syncDisplayName(uid, displayName.trim());
  return { success: true };
});
