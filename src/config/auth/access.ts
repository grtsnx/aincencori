import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc as orgAdminAc,
  defaultStatements as orgStatements,
  memberAc as orgMemberAc,
  ownerAc as orgOwnerAc,
} from 'better-auth/plugins/organization/access';

// The organization that holds platform staff. Created the first time an admin
// uses the staff routes. Fixed (not from .env) so it never changes under us.
export const staffOrganizationSlug = 'staff';

// Platform permissions. They only take effect in the Staff organization,
// where they decide what each staff role may do across the platform.
const platformStatements = {
  user: ['list', 'get', 'update', 'ban', 'impersonate', 'delete'],
  session: ['list', 'revoke'],
  staff: ['invite', 'list', 'update', 'remove'],
  // Read and answer chats an agent handed to a person.
  chat: ['read', 'reply'],
} as const;

// Everything a role (built-in or custom) can be given.
export const statements = {
  ...orgStatements,
  ...platformStatements,
} as const;

export const organizationAc = createAccessControl(statements);

// Built-in roles. Custom roles are created at runtime (dynamic access control).
export const organizationRoles = {
  owner: organizationAc.newRole({
    ...orgOwnerAc.statements,
    ...platformStatements,
  }),
  admin: organizationAc.newRole({
    ...orgAdminAc.statements,
    user: ['list', 'get', 'update', 'ban'],
    session: ['list', 'revoke'],
    staff: ['invite', 'list', 'update'],
    chat: ['read', 'reply'],
  }),
  member: organizationAc.newRole({
    ...orgMemberAc.statements,
  }),
};

// Every permission, grouped by resource, for permission pickers in the UI.
export const permissionCatalog = Object.fromEntries(
  Object.entries(statements).map(([resource, actions]) => [
    resource,
    [...actions],
  ]),
) as Record<keyof typeof statements, string[]>;
