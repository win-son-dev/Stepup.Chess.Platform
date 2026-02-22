import * as admin from 'firebase-admin';

export async function initUserStepBalance(uid: string): Promise<void> {
  await admin.database().ref(`steps/${uid}/balance`).set(0);
}

export async function createUserProfile(
  uid: string,
  displayName: string,
  avatarColor: number,
): Promise<void> {
  await admin.firestore().collection('users').doc(uid).set({
    id: uid,
    displayName,
    avatarColor,
    isOnline: false,
  });
}

export async function createLeaderboardEntry(uid: string, displayName: string): Promise<void> {
  await admin.firestore().collection('leaderboard').doc(uid).set({
    userId: uid,
    displayName,
    wins: 0,
    losses: 0,
    draws: 0,
    totalStepsSpent: 0,
    totalMovesPlayed: 0,
  });
}

/** Syncs displayName in both users/ and leaderboard/ atomically. */
export async function syncDisplayName(uid: string, name: string): Promise<void> {
  await Promise.all([
    admin.firestore().collection('users').doc(uid).update({ displayName: name }),
    admin.firestore().collection('leaderboard').doc(uid).update({ displayName: name }),
  ]);
}

