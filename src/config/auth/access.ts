import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc as orgAdminAc,
  defaultStatements as orgStatements,
  memberAc as orgMemberAc,
  ownerAc as orgOwnerAc,
} from 'better-auth/plugins/organization/access';

// Platform permissions. They only take effect in the Staff organization,
// where they decide what each staff role may do across the platform.
const platformStatements = {
  user: ['list', 'get', 'update', 'ban', 'impersonate', 'delete'],
  session: ['list', 'revoke'],
  staff: ['invite', 'list', 'update', 'remove'],
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
