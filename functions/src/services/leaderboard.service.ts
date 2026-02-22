import { OnlineGame } from '../types';
import { incrementWin, incrementLoss, incrementDraw } from '../repositories/leaderboard.repository';

/**
 * Applies win / loss / draw counters to the leaderboard based on the
 * completed game's outcome and winnerId fields.
 * No-ops if the game was abandoned or has no second player.
 */
export async function applyGameResult(game: OnlineGame): Promise<void> {
  if (!game.blackPlayerId || game.outcome === 'abandoned' || !game.outcome) return;

  if (game.outcome === 'win' && game.winnerId) {
    const loserId =
      game.winnerId === game.whitePlayerId ? game.blackPlayerId : game.whitePlayerId;
    await Promise.all([
      incrementWin(game.winnerId),
      incrementLoss(loserId),
    ]);
  } else if (game.outcome === 'draw') {
    await Promise.all([
      incrementDraw(game.whitePlayerId),
      incrementDraw(game.blackPlayerId),
    ]);
  }
}
