// Wording for the API docs (Swagger at /api, Scalar at /docs).
// Titles and section descriptions: at most 4 words.
// Route descriptions: one plain sentence, at most 12 words.

// Sections in the order the docs show them.
export const docSections: { name: string; description: string }[] = [
  { name: 'Server', description: 'Check server health' },
  { name: 'Auth', description: 'Sign users in securely' },
  { name: 'Agent Auth', description: 'Safe AI agent access' },
  { name: 'User', description: 'Manage your own account' },
  { name: 'Organization', description: 'Manage organizations and teams' },
  { name: 'Chat', description: 'Talk to AI agents' },
  { name: 'Routines', description: 'Scheduled agent tasks' },
  { name: 'Admin', description: 'Manage all users' },
];

export const userPaths = [
  '/update-user',
  '/delete-user',
  '/change-email',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/list-accounts',
  '/unlink-account',
  '/link-social',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
  '/get-session',
  '/update-session',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/multi-session',
  '/passkey/list-user-passkeys',
  '/passkey/delete-passkey',
  '/passkey/update-passkey',
];

// Better Auth routes left out of the docs: Dash internals, the browser error
// page, deprecated routes, and password routes (passwords are switched off).
export const hiddenPaths = [
  '/dash',
  '/events',
  '/error',
  '/forget-password',
  '/sign-up/email',
  '/sign-in/email',
  '/reset-password',
  '/verify-password',
  '/change-password',
  '/request-password-reset',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/admin/set-user-password',
];

// Title and description for every Better Auth route.
export const authRouteDocs: Record<
  string,
  { title: string; description: string }
> = {
  '/ok': {
    title: 'Check auth is running',
    description: 'Returns ok when the auth service is up.',
  },
  '/sign-in/social': {
    title: 'Sign in with provider',
    description: 'Starts Google, GitHub or LinkedIn sign-in; returns its link.',
  },
  '/callback/{id}': {
    title: 'Return from provider sign-in',
    description: 'The provider sends the user back here after sign-in.',
  },
  '/sign-out': {
    title: 'Sign out',
    description: 'Ends the current session and clears the cookie.',
  },
  '/verify-email': {
    title: 'Confirm email from link',
    description: 'Confirms an email address from the emailed link.',
  },
  '/send-verification-email': {
    title: 'Send email confirmation link',
    description: 'Emails a link to confirm the address.',
  },
  '/email-otp/send-verification-otp': {
    title: 'Send email code',
    description: 'Emails a 6-digit code for sign-in or confirmation.',
  },
  '/email-otp/check-verification-otp': {
    title: 'Check email code',
    description: 'Checks whether an emailed code is valid.',
  },
  '/email-otp/verify-email': {
    title: 'Confirm email with code',
    description: 'Confirms the email address using an emailed code.',
  },
  '/sign-in/email-otp': {
    title: 'Sign in with code',
    description: 'Signs in with an emailed code. New emails get accounts.',
  },
  '/passkey/generate-register-options': {
    title: 'Start adding a passkey',
    description: 'Gets the browser options to create a passkey.',
  },
  '/passkey/verify-registration': {
    title: 'Finish adding a passkey',
    description: 'Saves the new passkey after the browser creates it.',
  },
  '/passkey/generate-authenticate-options': {
    title: 'Start passkey sign-in',
    description: 'Gets the browser options to sign in with a passkey.',
  },
  '/passkey/verify-authentication': {
    title: 'Finish passkey sign-in',
    description: 'Signs in after the browser confirms the passkey.',
  },
  '/two-factor/enable': {
    title: 'Turn on 2FA',
    description: 'Starts 2FA setup for the signed-in user.',
  },
  '/two-factor/disable': {
    title: 'Turn off 2FA',
    description: 'Turns 2FA off for the signed-in user.',
  },
  '/two-factor/get-totp-uri': {
    title: 'Get authenticator app link',
    description: 'Returns the setup link for an authenticator app.',
  },
  '/two-factor/verify-totp': {
    title: 'Check authenticator app code',
    description: 'Checks a code from the authenticator app.',
  },
  '/two-factor/send-otp': {
    title: 'Email a 2FA code',
    description: 'Emails a one-time 2FA code.',
  },
  '/two-factor/verify-otp': {
    title: 'Check emailed 2FA code',
    description: 'Checks a 2FA code sent by email.',
  },
  '/two-factor/verify-backup-code': {
    title: 'Use a backup code',
    description: 'Signs in with a one-time backup code.',
  },
  '/two-factor/generate-backup-codes': {
    title: 'Create new backup codes',
    description: 'Replaces the backup codes with a new set.',
  },
  '/jwks': {
    title: 'Token signing keys',
    description: 'Public keys apps use to check issued tokens.',
  },
  '/oauth2/authorize': {
    title: 'Start app authorization',
    description: "Starts an app's request to access a user's account.",
  },
  '/oauth2/consent': {
    title: 'Give app consent',
    description: "Saves the user's yes or no for an app.",
  },
  '/oauth2/continue': {
    title: 'Continue app authorization',
    description: 'Resumes app authorization after sign-in or consent.',
  },
  '/oauth2/token': {
    title: 'Get app access token',
    description: 'Exchanges a code or refresh token for access tokens.',
  },
  '/oauth2/introspect': {
    title: 'Inspect app token',
    description: 'Tells an app whether a token is still valid.',
  },
  '/oauth2/revoke': {
    title: 'Revoke app token',
    description: "Cancels an app's access or refresh token.",
  },
  '/oauth2/userinfo': {
    title: 'Get signed-in user info',
    description: "Returns the signed-in user's profile to an app.",
  },
  '/oauth2/end-session': {
    title: 'Sign out of app',
    description: 'Signs the user out of an app.',
  },
  '/oauth2/end-session/confirm': {
    title: 'Confirm app sign-out',
    description: 'Confirms the app sign-out request.',
  },
  '/oauth2/register': {
    title: 'Register an app',
    description: 'Lets an app register itself, when allowed.',
  },
  '/oauth2/create-client': {
    title: 'Create an app',
    description: 'Creates an app that can use OAuth sign-in.',
  },
  '/oauth2/get-client': {
    title: 'Get an app',
    description: "Returns one app's settings.",
  },
  '/oauth2/public-client': {
    title: 'Get public app details',
    description: "Returns an app's public name, logo and links.",
  },
  '/oauth2/public-client-prelogin': {
    title: 'App details before sign-in',
    description: 'Returns public app details before the user signs in.',
  },
  '/oauth2/get-clients': {
    title: 'List my apps',
    description: 'Lists apps owned by the user or organization.',
  },
  '/oauth2/update-client': {
    title: 'Update an app',
    description: "Changes an app's settings.",
  },
  '/oauth2/client/rotate-secret': {
    title: 'Change app secret',
    description: 'Issues a new secret for an app.',
  },
  '/oauth2/client/rotate-keys': {
    title: 'Change app signing keys',
    description: "Replaces an app's signing keys.",
  },
  '/oauth2/delete-client': {
    title: 'Delete an app',
    description: 'Deletes an app and its access.',
  },
  '/oauth2/get-consent': {
    title: 'Get an app consent',
    description: 'Returns one access grant the user gave an app.',
  },
  '/oauth2/get-consents': {
    title: 'List app consents',
    description: 'Lists apps the user has given access.',
  },
  '/oauth2/update-consent': {
    title: 'Update an app consent',
    description: 'Changes what an app is allowed to access.',
  },
  '/oauth2/delete-consent': {
    title: 'Remove an app consent',
    description: "Removes an app's access to the user's account.",
  },
  '/get-session': {
    title: 'Get current session',
    description: 'Returns the signed-in user and session.',
  },
  '/update-session': {
    title: 'Update current session',
    description: 'Updates extra details on the current session.',
  },
  '/update-user': {
    title: 'Update my profile',
    description: "Changes the user's name or picture.",
  },
  '/delete-user': {
    title: 'Delete my account',
    description: "Deletes the signed-in user's account.",
  },
  '/delete-user/callback': {
    title: 'Confirm account deletion',
    description: 'Finishes deleting the account from the emailed link.',
  },
  '/change-email': {
    title: 'Change my email',
    description: "Starts changing the user's email address.",
  },
  '/email-otp/request-email-change': {
    title: 'Send email change code',
    description: 'Emails a code to the new address.',
  },
  '/email-otp/change-email': {
    title: 'Change email with code',
    description: 'Changes the email after checking the code.',
  },
  '/list-sessions': {
    title: 'List my sessions',
    description: 'Lists every device where the user is signed in.',
  },
  '/revoke-session': {
    title: 'End a session',
    description: 'Signs out one device.',
  },
  '/revoke-sessions': {
    title: 'End all sessions',
    description: 'Signs out every device, including this one.',
  },
  '/revoke-other-sessions': {
    title: 'End other sessions',
    description: 'Signs out every device except this one.',
  },
  '/link-social': {
    title: 'Link a provider account',
    description: 'Connects Google, GitHub or LinkedIn to this account.',
  },
  '/list-accounts': {
    title: 'List sign-in methods',
    description: 'Lists the ways this user can sign in.',
  },
  '/unlink-account': {
    title: 'Unlink a sign-in method',
    description: 'Removes a sign-in method from the account.',
  },
  '/refresh-token': {
    title: 'Refresh provider token',
    description: 'Gets a fresh token from a linked provider.',
  },
  '/get-access-token': {
    title: 'Get provider access token',
    description: 'Returns a valid token for a linked provider.',
  },
  '/account-info': {
    title: 'Get provider account info',
    description: 'Returns profile details from a linked provider.',
  },
  '/passkey/list-user-passkeys': {
    title: 'List my passkeys',
    description: "Lists the user's saved passkeys.",
  },
  '/passkey/delete-passkey': {
    title: 'Delete a passkey',
    description: "Removes one of the user's passkeys.",
  },
  '/passkey/update-passkey': {
    title: 'Rename a passkey',
    description: "Changes a passkey's display name.",
  },
  '/multi-session/list-device-sessions': {
    title: 'List signed-in accounts',
    description: 'Lists accounts signed in on this device.',
  },
  '/multi-session/set-active': {
    title: 'Switch account',
    description: 'Switches to another signed-in account.',
  },
  '/multi-session/revoke': {
    title: 'Sign out one account',
    description: 'Signs out one account on this device.',
  },
  '/admin/list-users': {
    title: 'List users',
    description: 'Lists all users, with search and paging.',
  },
  '/admin/get-user': {
    title: 'Get a user',
    description: "Returns one user's details.",
  },
  '/admin/create-user': {
    title: 'Create a user',
    description: 'Creates a user account directly.',
  },
  '/admin/update-user': {
    title: 'Update a user',
    description: "Changes a user's details.",
  },
  '/admin/remove-user': {
    title: 'Delete a user',
    description: 'Permanently deletes a user and their sessions.',
  },
  '/admin/set-role': {
    title: 'Change user role',
    description: "Changes a user's platform role.",
  },
  '/admin/ban-user': {
    title: 'Ban a user',
    description: 'Blocks a user from signing in.',
  },
  '/admin/unban-user': {
    title: 'Unban a user',
    description: 'Lets a banned user sign in again.',
  },
  '/admin/impersonate-user': {
    title: 'Impersonate a user',
    description: 'Signs in as a user to help them.',
  },
  '/admin/stop-impersonating': {
    title: 'Stop impersonating',
    description: 'Ends impersonation and restores the admin session.',
  },
  '/admin/list-user-sessions': {
    title: 'List user sessions',
    description: 'Lists where a user is signed in.',
  },
  '/admin/revoke-user-session': {
    title: 'End a user session',
    description: 'Signs a user out of one device.',
  },
  '/admin/revoke-user-sessions': {
    title: 'End all user sessions',
    description: 'Signs a user out everywhere.',
  },
  '/admin/has-permission': {
    title: 'Check admin permission',
    description: 'Checks if the admin can do an action.',
  },
  '/organization/create': {
    title: 'Create organization',
    description: 'Creates an organization owned by the user.',
  },
  '/organization/update': {
    title: 'Update organization',
    description: "Changes the organization's name, slug or logo.",
  },
  '/organization/delete': {
    title: 'Delete organization',
    description: 'Deletes the organization and its data.',
  },
  '/organization/list': {
    title: 'List my organizations',
    description: 'Lists organizations the user belongs to.',
  },
  '/organization/set-active': {
    title: 'Switch organization',
    description: 'Chooses which organization the user works in.',
  },
  '/organization/get-organization': {
    title: 'Get organization',
    description: "Returns an organization's basic details.",
  },
  '/organization/get-full-organization': {
    title: 'Get organization details',
    description: 'Returns members, invites and teams of an organization.',
  },
  '/organization/check-slug': {
    title: 'Check slug is free',
    description: 'Checks whether an organization link name is taken.',
  },
  '/organization/leave': {
    title: 'Leave organization',
    description: 'Removes the user from an organization.',
  },
  '/organization/invite-member': {
    title: 'Invite a member',
    description: 'Emails someone an invite to join.',
  },
  '/organization/get-invitation': {
    title: 'Get an invite',
    description: "Returns one invite's details.",
  },
  '/organization/accept-invitation': {
    title: 'Accept an invite',
    description: 'Joins the organization from an invite.',
  },
  '/organization/reject-invitation': {
    title: 'Decline an invite',
    description: 'Declines an invite.',
  },
  '/organization/cancel-invitation': {
    title: 'Cancel an invite',
    description: 'Withdraws an invite that was sent.',
  },
  '/organization/list-invitations': {
    title: 'List organization invites',
    description: 'Lists invites the organization has sent.',
  },
  '/organization/list-user-invitations': {
    title: 'List my invites',
    description: 'Lists invites the user has received.',
  },
  '/organization/list-members': {
    title: 'List members',
    description: "Lists the organization's members and roles.",
  },
  '/organization/remove-member': {
    title: 'Remove a member',
    description: 'Removes a member from the organization.',
  },
  '/organization/update-member-role': {
    title: 'Change member role',
    description: "Changes a member's role.",
  },
  '/organization/get-active-member': {
    title: 'Get my membership',
    description: "Returns the user's membership in this organization.",
  },
  '/organization/get-active-member-role': {
    title: 'Get my role',
    description: "Returns the user's role in this organization.",
  },
  '/organization/has-permission': {
    title: 'Check my permission',
    description: 'Checks if the user can do an action.',
  },
  '/organization/create-team': {
    title: 'Create a team',
    description: 'Creates a team in the organization.',
  },
  '/organization/update-team': {
    title: 'Update a team',
    description: "Changes a team's name.",
  },
  '/organization/remove-team': {
    title: 'Delete a team',
    description: 'Deletes a team.',
  },
  '/organization/list-teams': {
    title: 'List teams',
    description: "Lists the organization's teams.",
  },
  '/organization/list-user-teams': {
    title: 'List my teams',
    description: 'Lists teams the user belongs to.',
  },
  '/organization/set-active-team': {
    title: 'Switch team',
    description: 'Chooses which team the user works in.',
  },
  '/organization/list-team-members': {
    title: 'List team members',
    description: 'Lists members of a team.',
  },
  '/organization/add-team-member': {
    title: 'Add team member',
    description: 'Adds a member to a team.',
  },
  '/organization/remove-team-member': {
    title: 'Remove team member',
    description: 'Removes a member from a team.',
  },
  '/agent-configuration': {
    title: 'Agent discovery document',
    description: 'Tells agents how to register and what they can do.',
  },
  '/agent/register': {
    title: 'Register an agent',
    description: 'A host registers a new agent for the user.',
  },
  '/agent/list': {
    title: 'List my agents',
    description: 'Lists agents acting for the signed-in user.',
  },
  '/agent/get': {
    title: 'Get an agent',
    description: "Returns one agent's details, without secrets.",
  },
  '/agent/update': {
    title: 'Update an agent',
    description: "Changes an agent's name or details.",
  },
  '/agent/revoke': {
    title: 'Revoke an agent',
    description: 'Stops an agent from acting for the user.',
  },
  '/agent/revoke-capability': {
    title: 'Remove agent capability',
    description: 'Takes back one or more capabilities from an agent.',
  },
  '/agent/rotate-key': {
    title: 'Change agent key',
    description: "Replaces an agent's public key.",
  },
  '/agent/reactivate': {
    title: 'Reactivate an agent',
    description: 'Turns an expired agent back on with default capabilities.',
  },
  '/agent/session': {
    title: 'Get agent session',
    description: 'Returns the agent behind a signed agent token.',
  },
  '/agent/cleanup': {
    title: 'Expire overdue agents',
    description: "Expires the user's agents that are past their lifetime.",
  },
  '/agent/request-capability': {
    title: 'Request agent capability',
    description: 'An agent asks the user for more capabilities.',
  },
  '/agent/approve-capability': {
    title: 'Approve agent request',
    description: 'The user approves or denies an agent request.',
  },
  '/agent/status': {
    title: 'Get agent status',
    description: "Returns an agent's status and its capability grants.",
  },
  '/agent/introspect': {
    title: 'Check an agent token',
    description: 'Checks an agent token and returns its grants.',
  },
  '/agent/grant-capability': {
    title: 'Grant agent capability',
    description: 'The user gives an agent more capabilities.',
  },
  '/agent/ciba/authorize': {
    title: 'Ask user to approve',
    description: 'Sends the user an approval request for an agent.',
  },
  '/agent/ciba/pending': {
    title: 'List pending approvals',
    description: 'Lists approval requests waiting for the user.',
  },
  '/agent/device/code': {
    title: 'Get device code',
    description: 'Issues a code the user enters to approve an agent.',
  },
  '/agent/claim': {
    title: 'Claim an agent',
    description: 'Starts claiming an agent that has no user yet.',
  },
  '/capability/list': {
    title: 'List capabilities',
    description: 'Lists what agents can ask a user to allow.',
  },
  '/capability/describe': {
    title: 'Describe a capability',
    description: 'Returns full details for one capability.',
  },
  '/capability/execute': {
    title: 'Run a capability',
    description: 'An agent runs a capability the user granted.',
  },
  '/capability/batch-execute': {
    title: 'Run several capabilities',
    description: 'An agent runs several granted capabilities at once.',
  },
  '/host/create': {
    title: 'Create an agent host',
    description: 'Registers a device or app that runs agents.',
  },
  '/host/enroll': {
    title: 'Enroll a host',
    description: 'Enrolls a device using a one-time token.',
  },
  '/host/list': {
    title: 'List my hosts',
    description: 'Lists devices and apps that run agents for the user.',
  },
  '/host/get': {
    title: 'Get a host',
    description: "Returns one host's details.",
  },
  '/host/revoke': {
    title: 'Revoke a host',
    description: 'Stops a host and all its agents.',
  },
  '/host/switch-account': {
    title: 'Move host to me',
    description: "Moves a host to the user's account, revoking its agents.",
  },
  '/host/update': {
    title: 'Update a host',
    description: "Changes a host's name, key or default capabilities.",
  },
  '/host/rotate-key': {
    title: 'Change host key',
    description: "Replaces a host's public key.",
  },
  '/organization/create-role': {
    title: 'Create a role',
    description: 'Creates a custom role with chosen permissions.',
  },
  '/organization/update-role': {
    title: 'Update a role',
    description: "Changes a custom role's permissions.",
  },
  '/organization/delete-role': {
    title: 'Delete a role',
    description: 'Deletes a custom role no one uses.',
  },
  '/organization/list-roles': {
    title: 'List roles',
    description: "Lists the organization's custom roles.",
  },
  '/organization/get-role': {
    title: 'Get a role',
    description: "Returns one custom role's permissions.",
  },
};
