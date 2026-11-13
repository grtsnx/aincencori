// Limits that keep agent runs fast and costs predictable.

// Most steps (model calls) in one run, chat or routine.
export const maxAgentTurns = 10;

// Routines: how many each user may have, and the shortest gap between runs.
export const maxRoutinesPerUser = 25;
export const minRoutineIntervalMinutes = 15;

// How many routines run at the same time on one server.
export const routineConcurrency = 5;

// MCP servers each user may connect.
export const maxIntegrationsPerUser = 10;

// Bots each user may create.
export const maxBotsPerUser = 50;

// Per bot: facts it may keep (the newest ones go into each chat), and skills.
export const maxMemoriesPerBot = 200;
export const memoriesInPrompt = 50;
export const maxSkillsPerBot = 20;

// Bots the default assistant may hand a chat to.
export const maxBotsForAssistant = 10;
