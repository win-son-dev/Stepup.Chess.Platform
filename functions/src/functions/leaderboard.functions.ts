import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { OnlineGame } from '../types';
import { applyGameResult } from '../services/leaderboard.service';
import { leaderboardConfig } from '../config/instances';

/**
 * Fires whenever a game document is updated in Firestore.
 * Only acts when the status transitions to 'completed'.
 * endGame writes outcome + winnerId into the document before this fires,
 * so all the data needed to update the leaderboard is already there.
 */
export const onGameCompleted = onDocumentUpdated(
  { document: 'games/{gameId}', ...leaderboardConfig },
  async (event) => {
    const before = event.data?.before.data() as OnlineGame | undefined;
    const after  = event.data?.after.data()  as OnlineGame | undefined;

    if (!before || !after) return;
    if (before.status === after.status || after.status !== 'completed') return;

    await applyGameResult(after);
  },
);
