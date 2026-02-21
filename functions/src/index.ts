import * as admin from 'firebase-admin';

admin.initializeApp();

export { submitStepDelta } from './submitStepDelta';
export { createGame, joinGame, makeMove, endGame } from './game';
export { matchmakingOnQueueWrite } from './matchmaking';
export { onUserCreated, updateDisplayName } from './user';
