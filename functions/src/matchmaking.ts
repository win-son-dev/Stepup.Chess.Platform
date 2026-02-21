import * as admin from 'firebase-admin';
import { onValueCreated } from 'firebase-functions/v2/database';
import { OnlineGame } from './types';
import { matchmakingConfig } from './config/instances';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * matchmakingOnQueueWrite
 *
 * Triggered when any player writes to /queue/{userId}.
 * Reads all queued players sorted by joinedAt (FIFO), pairs the two oldest,
 * creates a game, notifies both via /matches/{userId}/gameId, then removes
 * both from the queue.
 *
 * The Flutter client watches /matches/{userId}/gameId and navigates to the
 * game when this value appears.
 */
export const matchmakingOnQueueWrite = onValueCreated(
  { ref: '/queue/{userId}', ...matchmakingConfig },
  async () => {
    const db = admin.database();

    const snapshot = await db.ref('queue').orderByChild('joinedAt').get();
    const entries: Array<{ userId: string; joinedAt: number }> = [];
    snapshot.forEach((child) => {
      entries.push({ userId: child.key!, joinedAt: child.val().joinedAt as number });
    });

    if (entries.length < 2) return;

    const [player1, player2] = entries;

    const gameRef = db.ref('games').push();
    const gameId = gameRef.key!;

    const game: OnlineGame = {
      id: gameId,
      whitePlayerId: player1.userId,
      blackPlayerId: player2.userId,
      fen: INITIAL_FEN,
      moveHistory: [],
      status: 'active',
      presetName: 'Normal',
      costModeName: 'distance',
      createdAt: new Date().toISOString(),
    };

    await Promise.all([
      gameRef.set(game),
      admin.firestore().collection('games').doc(gameId).set(game),
      db.ref(`matches/${player1.userId}`).set({ gameId }),
      db.ref(`matches/${player2.userId}`).set({ gameId }),
      db.ref(`queue/${player1.userId}`).remove(),
      db.ref(`queue/${player2.userId}`).remove(),
      db.ref(`userActiveGame/${player1.userId}`).set(gameId),
      db.ref(`userActiveGame/${player2.userId}`).set(gameId),
    ]);
  },
);
