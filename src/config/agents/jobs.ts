// Background jobs that tidy up at Cencori. Named here so the code that
// queues them and the code that runs them agree.

// Removes a deleted user's space (tenant) and its app sign-ins.
export const deleteWorkspaceJob = 'cencori-tenant-delete';

// Removes the Cencori agent behind a deleted bot.
export const deleteBotAgentJob = 'cencori-agent-delete';
