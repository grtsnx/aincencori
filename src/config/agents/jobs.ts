// Background jobs that tidy up at Cencori. Named here so the code that
// queues them and the code that runs them agree.

// Removes a deleted user's space (tenant) and its app sign-ins.
export const deleteWorkspaceJob = 'cencori-tenant-delete';

// Removes the Cencori agent behind a deleted bot.
export const deleteBotAgentJob = 'cencori-agent-delete';

// Removes a chat's copy at Cencori (also side chats: a bot asked inside a
// group, the planner, the marketplace reviewer).
export const deleteCencoriSessionJob = 'cencori-session-delete';

// Removes stored chat files: some by key, or all under a prefix (one user's).
export const deleteFilesJob = 'r2-file-delete';

// Where one user's chat files live in storage.
export const userFilesPrefix = (userId: string): string => `chats/${userId}/`;

// Where one user's knowledge files live in storage.
export const userKnowledgePrefix = (userId: string): string =>
  `knowledge/${userId}/`;

// Reads a new document and makes it searchable.
export const indexDocumentJob = 'document-index';

// Works through a plan's steps.
export const runPlanJob = 'plan-run';

// Safety review of a bot shared on the marketplace.
export const reviewListingJob = 'listing-review';
