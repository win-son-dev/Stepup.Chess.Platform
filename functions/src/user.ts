import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { beforeUserCreated } from 'firebase-functions/v2/identity';

/**
 * onUserCreated
 *
 * Triggered automatically by Firebase Auth when a new user account is created.
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
    // Step balance — RTDB, client streams this via watchBalance()
    admin.database().ref(`steps/${uid}/balance`).set(0),

    // User profile — Firestore
    admin.firestore().collection('users').doc(uid).set({
      id: uid,
      displayName,
      avatarColor: _randomAvatarColor(),
      isOnline: false,
    }),

    // Leaderboard entry — Firestore
    admin.firestore().collection('leaderboard').doc(uid).set({
      userId: uid,
      displayName,
      wins: 0,
      losses: 0,
      draws: 0,
      totalStepsSpent: 0,
      totalMovesPlayed: 0,
    }),
  ]);
});

/**
 * updateDisplayName
 *
 * Updates the display name in both users/ and leaderboard/ atomically.
 * Caller identity comes from the bearer token — never from request body.
 *
 * Input:  { displayName: string }
 * Output: { success: true }
 */
export const updateDisplayName = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  const uid = request.auth.uid;

  const { displayName } = request.data as { displayName: string };

  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'displayName is required');
  }

  const name = displayName.trim();

  await Promise.all([
    admin.firestore().collection('users').doc(uid).update({ displayName: name }),
    admin.firestore().collection('leaderboard').doc(uid).update({ displayName: name }),
  ]);

  return { success: true };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a random ARGB int for the avatar background, matching Dart's int color format. */
function _randomAvatarColor(): number {
  const colors = [
    0xFF5C6BC0, // indigo
    0xFF26A69A, // teal
    0xFFEF5350, // red
    0xFF66BB6A, // green
    0xFFFFA726, // orange
    0xFFAB47BC, // purple
    0xFF29B6F6, // light blue
    0xFFEC407A, // pink
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
