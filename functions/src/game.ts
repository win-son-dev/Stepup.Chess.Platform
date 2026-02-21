import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Chess } from 'chess.js';
import { OnlineGame, OnlineGameStatus, CostMode, PieceType } from './types';
import { getPreset } from './presets';
import { calculateCost } from './costCalculator';
import {
  createGameConfig,
  joinGameConfig,
  makeMoveConfig,
  endGameConfig,
} from './config/instances';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function requireAuth(request: { auth?: { uid: string } }): string {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  return request.auth.uid;
}

async function getGame(gameId: string): Promise<OnlineGame> {
  const snapshot = await admin.database().ref(`games/${gameId}`).get();
  if (!snapshot.exists()) {
    throw new HttpsError('not-found', `Game ${gameId} not found`);
  }
  return snapshot.val() as OnlineGame;
}

async function assertNoActiveGame(uid: string): Promise<void> {
  const snap = await admin.database().ref(`userActiveGame/${uid}`).get();
  if (snap.exists()) {
    throw new HttpsError(
      'failed-precondition',
      'You already have an active game. Finish or resign it first.',
    );
  }
}

// ─── createGame ──────────────────────────────────────────────────────────────

/**
 * createGame
 *
 * The caller becomes white. Game starts in 'waiting' until a second player joins.
 *
 * Input:  { presetName, costModeName }
 * Output: { gameId }
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

  getPreset(presetName); // throws if unknown

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

  await Promise.all([
    gameRef.set(game),
    admin.firestore().collection('games').doc(gameId).set(game),
    admin.database().ref(`userActiveGame/${uid}`).set(gameId),
  ]);

  return { gameId };
});

// ─── joinGame ────────────────────────────────────────────────────────────────

/**
 * joinGame
 *
 * The caller joins a waiting game as black. Sets status to 'active'.
 *
 * Input:  { gameId }
 * Output: { success: true }
 */
export const joinGame = onCall(joinGameConfig, async (request) => {
  const uid = requireAuth(request);

  const { gameId } = request.data as { gameId: string };

  if (!gameId) {
    throw new HttpsError('invalid-argument', 'gameId is required');
  }

  const game = await getGame(gameId);

  if (game.blackPlayerId != null || game.status !== 'waiting') {
    throw new HttpsError('failed-precondition', 'Game is already full');
  }
  if (game.whitePlayerId === uid) {
    throw new HttpsError('failed-precondition', 'Cannot join your own game');
  }

  await assertNoActiveGame(uid);

  const updates: Partial<OnlineGame> = {
    blackPlayerId: uid,
    status: 'active' as OnlineGameStatus,
  };

  await Promise.all([
    admin.database().ref(`games/${gameId}`).update(updates),
    admin.firestore().collection('games').doc(gameId).update(updates),
    admin.database().ref(`userActiveGame/${uid}`).set(gameId),
  ]);

  return { success: true };
});

// ─── makeMove ────────────────────────────────────────────────────────────────

/**
 * makeMove
 *
 * The authoritative move handler. The caller must be a player in the game.
 * Validates the move, checks step balance, deducts cost, updates game state.
 *
 * Key StepUp Chess rules:
 *   - Either player may move at any time (free-play — no turn enforcement).
 *     The FEN's active color is swapped to match the caller before validation.
 *   - King captures are custom: chess.js forbids them, so when capturingKing=true
 *     we remove the king, place the attacker, and rebuild the FEN manually.
 *   - King captures cost double (calculateCost handles this).
 *
 * Input:  { gameId, from, to, promotion?, capturingKing? }
 * Output: { fen, moveHistory, cost, newBalance }
 */
export const makeMove = onCall(makeMoveConfig, async (request) => {
  const uid = requireAuth(request);

  const {
    gameId,
    from,
    to,
    promotion,
    capturingKing = false,
  } = request.data as {
    gameId: string;
    from: string;
    to: string;
    promotion?: string;
    capturingKing?: boolean;
  };

  if (!gameId || !from || !to) {
    throw new HttpsError('invalid-argument', 'gameId, from, and to are required');
  }

  const game = await getGame(gameId);

  if (game.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Game is not active');
  }
  if (uid !== game.whitePlayerId && uid !== game.blackPlayerId) {
    throw new HttpsError('permission-denied', 'You are not a player in this game');
  }

  // ── Move validation ────────────────────────────────────────────────────────

  let piece: string;
  let newFen: string;

  if (capturingKing) {
    // King capture: chess.js forbids this, so manipulate the board directly.
    const chess = new Chess(game.fen);
    const attacker = chess.get(from as Parameters<typeof chess.get>[0]);
    if (!attacker) {
      throw new HttpsError('invalid-argument', `No piece at ${from}`);
    }
    piece = attacker.type.toUpperCase();

    chess.remove(to as Parameters<typeof chess.remove>[0]);
    chess.remove(from as Parameters<typeof chess.remove>[0]);
    chess.put(attacker, to as Parameters<typeof chess.put>[1]);
    newFen = chess.fen();
  } else {
    // Normal move — align turn to caller so either player can move (free-play mechanic)
    const playerColor = uid === game.whitePlayerId ? 'w' : 'b';
    const fenParts = game.fen.split(' ');
    if (fenParts[1] !== playerColor) {
      fenParts[1] = playerColor;
    }
    const chess = new Chess(fenParts.join(' '));

    const boardPiece = chess.get(from as Parameters<typeof chess.get>[0]);
    if (!boardPiece) {
      throw new HttpsError('invalid-argument', `No piece at ${from}`);
    }
    piece = boardPiece.type.toUpperCase();

    const moveResult = chess.move({
      from,
      to,
      promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined,
    });
    if (!moveResult) {
      throw new HttpsError('invalid-argument', `Illegal move: ${from}-${to}`);
    }
    newFen = chess.fen();
  }

  // ── Cost calculation ───────────────────────────────────────────────────────

  const preset = getPreset(game.presetName);
  const pieceType = piece.toLowerCase() as PieceType;
  const cost = calculateCost(
    preset,
    game.costModeName as CostMode,
    pieceType,
    from,
    to,
    capturingKing,
  );

  // ── Balance check ──────────────────────────────────────────────────────────

  // Balance is game-scoped: accumulated only from game-start to game-end.
  const balanceRef = admin.database().ref(`games/${gameId}/steps/${uid}/balance`);
  const balanceSnap = await balanceRef.get();
  const balance = (balanceSnap.val() as number | null) ?? 0;

  if (balance < cost) {
    throw new HttpsError(
      'failed-precondition',
      `Insufficient steps: need ${cost}, have ${balance}`,
    );
  }

  // ── Apply updates ──────────────────────────────────────────────────────────

  const moveRecord = `${from}${to}${promotion ?? ''}`;
  const newMoveHistory = [...game.moveHistory, moveRecord];
  const newBalance = balance - cost;

  const tx = {
    amount: -cost,
    balanceAfter: newBalance,
    source: capturingKing ? 'king_capture' : 'move',
    timestamp: new Date().toISOString(),
    gameId,
    piece,
    moveFrom: from,
    moveTo: to,
  };

  await Promise.all([
    admin.database().ref(`games/${gameId}`).update({
      fen: newFen,
      moveHistory: newMoveHistory,
    }),
    balanceRef.set(newBalance),
    admin
      .firestore()
      .collection('stepTransactions')
      .doc(uid)
      .collection('transactions')
      .add(tx),
    admin
      .firestore()
      .collection('leaderboard')
      .doc(uid)
      .set(
        {
          totalStepsSpent: admin.firestore.FieldValue.increment(cost),
          totalMovesPlayed: admin.firestore.FieldValue.increment(1),
        },
        { merge: true },
      ),
  ]);

  return { fen: newFen, moveHistory: newMoveHistory, cost, newBalance };
});

// ─── endGame ─────────────────────────────────────────────────────────────────

/**
 * endGame
 *
 * Marks a game as completed or abandoned and updates leaderboard stats.
 * The caller must be a player in the game.
 *
 * outcome:
 *   'win'       — the caller won (king captured)
 *   'draw'      — both players drew
 *   'abandoned' — game abandoned, no stats updated
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

  const finalStatus = outcome === 'abandoned' ? 'abandoned' : 'completed';
  const statusUpdate = { status: finalStatus };

  const clearActiveGameUpdates: Record<string, null> = {
    [`userActiveGame/${game.whitePlayerId}`]: null,
  };
  if (game.blackPlayerId) {
    clearActiveGameUpdates[`userActiveGame/${game.blackPlayerId}`] = null;
  }

  await Promise.all([
    admin.database().ref(`games/${gameId}`).update(statusUpdate),
    admin.firestore().collection('games').doc(gameId).update(statusUpdate),
    admin.database().ref().update(clearActiveGameUpdates),
  ]);

  if (finalStatus === 'completed' && game.blackPlayerId) {
    const batch = admin.firestore().batch();
    const lb = admin.firestore().collection('leaderboard');

    if (outcome === 'win') {
      const loserId = uid === game.whitePlayerId ? game.blackPlayerId : game.whitePlayerId;
      batch.set(lb.doc(uid), { wins: admin.firestore.FieldValue.increment(1) }, { merge: true });
      batch.set(lb.doc(loserId), { losses: admin.firestore.FieldValue.increment(1) }, { merge: true });
    } else {
      batch.set(lb.doc(game.whitePlayerId), { draws: admin.firestore.FieldValue.increment(1) }, { merge: true });
      batch.set(lb.doc(game.blackPlayerId), { draws: admin.firestore.FieldValue.increment(1) }, { merge: true });
    }

    await batch.commit();
  }

  return { success: true };
});
