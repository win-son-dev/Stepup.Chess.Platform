import * as admin from 'firebase-admin';

admin.initializeApp();

export { submitStepDelta } from './functions/steps.functions';
export { createGame, joinGame, makeMove, endGame } from './functions/game.functions';
export { matchmakingOnQueueWrite } from './functions/matchmaking.functions';
export { onUserCreated, updateDisplayName } from './functions/user.functions';
export { onGameCompleted } from './functions/leaderboard.functions';
