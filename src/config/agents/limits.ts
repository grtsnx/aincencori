// Limits that keep agent runs fast and costs predictable.

// Most steps (model calls) in one run, chat or routine.
export const maxAgentTurns = 10;

// Routines: how many each user may have, and the shortest gap between runs.
export const maxRoutinesPerUser = 25;
export const minRoutineIntervalMinutes = 15;

// How many routines run at the same time on one server.
export const routineConcurrency = 5;
