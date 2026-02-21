.PHONY: start stop emulators build deploy-dev deploy-prod

## start: kill stale ports, build functions, start emulators
start:
	@echo "→ Clearing stale emulator ports..."
	-lsof -ti :9099,5001,8080,9000,4000 | xargs kill -9 2>/dev/null; true
	@sleep 1
	@echo "→ Building Cloud Functions..."
	cd functions && npm run build
	@echo "→ Starting Firebase emulators..."
	firebase emulators:start --only auth,functions,database,firestore

## stop: kill all emulator processes
stop:
	@echo "→ Stopping emulators..."
	-lsof -ti :9099,5001,8080,9000,4000 | xargs kill -9 2>/dev/null; true
	@echo "Done."

## emulators: start emulators without rebuilding functions
emulators:
	firebase emulators:start --only auth,functions,database,firestore

## build: compile Cloud Functions TypeScript
build:
	cd functions && npm run build

## deploy-dev: deploy functions + rules to dev project
deploy-dev:
	firebase use stepup-chess-dev
	cd functions && npm run build
	firebase deploy --only functions,database,firestore:rules

## deploy-prod: deploy functions + rules to prod project
deploy-prod:
	firebase use stepup-chess
	cd functions && npm run build
	firebase deploy --only functions,database,firestore:rules
