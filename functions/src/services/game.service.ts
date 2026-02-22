import { HttpsError } from 'firebase-functions/v2/https';
import { Chess } from 'chess.js';
import { OnlineGame, StepCostPreset, CostMode, PieceType } from '../types';
import { calculateCost } from '../utils/cost-calculator';

export type MoveResult = {
  newFen: string;
  cost: number;
  moveRecord: string;
};

/**
 * Validates a move against chess rules and applies it to the board.
 * Returns the resulting FEN, move record, piece moved, and step cost.
 *
 * Handles two cases:
 *   - Normal moves: FEN turn is aligned to the caller so either player can
 *     move at any time (StepUp free-play mechanic).
 *   - King captures: chess.js forbids these, so the board is manipulated
 *     directly (remove king, place attacker).
 */
export function validateAndApplyMove(
  game: OnlineGame,
  uid: string,
  from: string,
  to: string,
  promotion: string | undefined,
  capturingKing: boolean,
  preset: StepCostPreset,
): MoveResult {
  let piece: string;
  let newFen: string;

  if (capturingKing) {
    const chess = new Chess(game.fen);
    const attacker = chess.get(from as Parameters<typeof chess.get>[0]);
    if (!attacker) throw new HttpsError('invalid-argument', `No piece at ${from}`);
    piece = attacker.type.toUpperCase();

    chess.remove(to as Parameters<typeof chess.remove>[0]);
    chess.remove(from as Parameters<typeof chess.remove>[0]);
    chess.put(attacker, to as Parameters<typeof chess.put>[1]);
    newFen = chess.fen();
  } else {
    // Align FEN turn to caller — free-play mechanic
    const playerColor = uid === game.whitePlayerId ? 'w' : 'b';
    const fenParts = game.fen.split(' ');
    if (fenParts[1] !== playerColor) fenParts[1] = playerColor;
    const chess = new Chess(fenParts.join(' '));

    const boardPiece = chess.get(from as Parameters<typeof chess.get>[0]);
    if (!boardPiece) throw new HttpsError('invalid-argument', `No piece at ${from}`);
    piece = boardPiece.type.toUpperCase();

    // Resolve promotion piece — accept any case from client.
    // If the client omits it but this is clearly a pawn reaching the last rank,
    // default to queen so the move never fails for that reason.
    const isPromotion = boardPiece.type === 'p' && (to[1] === '8' || to[1] === '1');
    const promotionPiece = (promotion?.toLowerCase() ?? (isPromotion ? 'q' : undefined)) as
      'q' | 'r' | 'b' | 'n' | undefined;

    // chess.js v1.x throws on illegal moves instead of returning null
    try {
      chess.move({ from, to, promotion: promotionPiece });
    } catch {
      throw new HttpsError('invalid-argument', `Illegal move: ${from}-${to}`);
    }
    newFen = chess.fen();
  }

  const pieceType = piece.toLowerCase() as PieceType;
  const cost = calculateCost(
    preset,
    game.costModeName as CostMode,
    pieceType,
    from,
    to,
    capturingKing,
  );

  return { newFen, cost, moveRecord: `${from}${to}${promotion ?? ''}` };
}
