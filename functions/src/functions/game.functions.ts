import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OnlineGame, OnlineGameStatus } from '../types';
import { INITIAL_FEN } from '../utils/constants';
import { getPreset, KNOWN_PRESET_NAMES } from '../utils/presets';
import { getConfigAsync } from '../config/config.service';
import {
  getGame,
  createGameRecord,
  updateGameState,
  updateGameMove,
  setUserActiveGame,
  clearUserActiveGames,
  assertNoActiveGame,
} from '../repositories/game.repository';
import { getStepBalance, setStepBalance } from '../repositories/step.repository';
import { validateAndApplyMove } from '../services/game.service';
import {
  createGameConfig,
  joinGameConfig,
  makeMoveConfig,
  endGameConfig,
} from '../config/instances';
import * as admin from 'firebase-admin';

function requireAuth(request: { auth?: { uid: string } }): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  return request.auth.uid;
}

// ─── createGame ──────────────────────────────────────────────────────────────

/**
 * The caller becomes white. Game starts in 'waiting' until a second player joins.
 *
 * Input:  { presetName: string, costModeName: string }
 * Output: { gameId: string }
 */
export const createGame = onCall(createGameConfig, async (request) => {
  const uid = requireAuth(request);

  const { presetName, costModeName } = request.data as {
    presetName: string;
    costModeName: string;
  };

  if (!presetName || !costModeName) {
    throw new HttpsError('invalid-argument', 'presetName and costModeName are required');
  }

  if (!KNOWN_PRESET_NAMES.includes(presetName)) {
    throw new HttpsError('invalid-argument', `Unknown preset: ${presetName}`);
  }
  await assertNoActiveGame(uid);

  const gameRef = admin.database().ref('games').push();
  const gameId = gameRef.key!;

  const game: OnlineGame = {
    id: gameId,
    whitePlayerId: uid,
    blackPlayerId: null,
    fen: INITIAL_FEN,
    moveHistory: [],
    status: 'waiting',
    presetName,
    costModeName,
    createdAt: new Date().toISOString(),
  };

  await createGameRecord(gameId, game, uid);
  return { gameId };
});

// ─── joinGame ────────────────────────────────────────────────────────────────

/**
 * The caller joins a waiting game as black. Sets status to 'active'.
 *
 * Input:  { gameId: string }
 * Output: { success: true }
 */
export const joinGame = onCall(joinGameConfig, async (request) => {
  const uid = requireAuth(request);

  const { gameId } = request.data as { gameId: string };
  if (!gameId) throw new HttpsError('invalid-argument', 'gameId is required');

  const game = await getGame(gameId);

  if (game.blackPlayerId != null || game.status !== 'waiting') {
    throw new HttpsError('failed-precondition', 'Game is already full');
  }

  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  if (!isEmulator && game.whitePlayerId === uid) {
    throw new HttpsError('failed-precondition', 'Cannot join your own game');
  }

  // Skip the active-game guard for self-join in emulator: the white player
  // already holds this game in userActiveGame.
  if (!isEmulator || game.whitePlayerId !== uid) {
    await assertNoActiveGame(uid);
  }

  const updates: Partial<OnlineGame> = {
    blackPlayerId: uid,
    status: 'active' as OnlineGameStatus,
  };

  await Promise.all([
    updateGameState(gameId, updates),
    setUserActiveGame(uid, gameId),
  ]);

  return { success: true };
});

// ─── makeMove ────────────────────────────────────────────────────────────────

/**
 * Authoritative move handler. Validates the move, checks step balance,
 * deducts cost, and updates game state.
 *
 * Key StepUp rules:
 *   - Either player may move at any time (free-play — no turn enforcement).
 *   - King captures are custom (chess.js forbids them); pass capturingKing=true.
 *   - King captures cost double (handled in calculateCost).
 *
 * Input:  { gameId, from, to, promotion?, capturingKing? }
 * Output: { fen, moveHistory, cost, newBalance }
 */
export const makeMove = onCall(makeMoveConfig, async (request) => {
  const uid = requireAuth(request);

  const { gameId, from, to, promotion, capturingKing = false } = request.data as {
    gameId: string;
    from: string;
    to: string;
    promotion?: string;
    capturingKing?: boolean;
  };

  if (!gameId || !from || !to) {
    throw new HttpsError('invalid-argument', 'gameId, from, and to are required');
  }

  const [game, config] = await Promise.all([getGame(gameId), getConfigAsync()]);

  if (game.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Game is not active');
  }
  if (uid !== game.whitePlayerId && uid !== game.blackPlayerId) {
    throw new HttpsError('permission-denied', 'You are not a player in this game');
  }

  const preset = getPreset(config, game.presetName);
  const { newFen, cost, moveRecord } = validateAndApplyMove(
    game, uid, from, to, promotion, capturingKing, preset,
  );

  const balance = await getStepBalance(gameId, uid);
  if (balance < cost) {
    throw new HttpsError(
      'failed-precondition',
      `Insufficient steps: need ${cost}, have ${balance}`,
    );
  }

  const newMoveHistory = [...(game.moveHistory ?? []), moveRecord];
  const newBalance = balance - cost;

  await Promise.all([
    updateGameMove(gameId, newFen, newMoveHistory),
    setStepBalance(gameId, uid, newBalance),
  ]);

  return { fen: newFen, moveHistory: newMoveHistory, cost, newBalance };
});

// ─── endGame ─────────────────────────────────────────────────────────────────

/**
 * Marks a game as completed or abandoned and updates leaderboard stats.
 * The caller must be a player in the game.
 *
 * outcome:
 *   'win'       — caller won (king captured); opponent gets a loss
 *   'draw'      — both players drew
 *   'abandoned' — game abandoned, no stats recorded
 *
 * Input:  { gameId, outcome: 'win' | 'draw' | 'abandoned' }
 * Output: { success: true }
 */
export const endGame = onCall(endGameConfig, async (request) => {
  const uid = requireAuth(request);

  const { gameId, outcome } = request.data as {
    gameId: string;
    outcome: 'win' | 'draw' | 'abandoned';
  };

  if (!gameId || !outcome) {
    throw new HttpsError('invalid-argument', 'gameId and outcome are required');
  }

  const game = await getGame(gameId);

  if (uid !== game.whitePlayerId && uid !== game.blackPlayerId) {
    throw new HttpsError('permission-denied', 'You are not a player in this game');
  }

  const finalStatus = (outcome === 'abandoned' ? 'abandoned' : 'completed') as OnlineGameStatus;
  const uidsToClean = [game.whitePlayerId, ...(game.blackPlayerId ? [game.blackPlayerId] : [])];

  const gameUpdate: Partial<OnlineGame> = { status: finalStatus, outcome };
  if (outcome === 'win') gameUpdate.winnerId = uid;

  await Promise.all([
    updateGameState(gameId, gameUpdate),
    clearUserActiveGames(uidsToClean),
  ]);

  return { success: true };
});
