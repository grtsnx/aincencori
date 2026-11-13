// Runs after `auth generate`. Better Auth's Prisma generator gets one model
// wrong: AgentCapabilityGrant links to User twice (grantedBy and deniedBy), and
// the generator merges both links into one invalid field. This rewrites them as
// two named relations and keeps User's back-links in step.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'prisma/schema.prisma';
let schema = readFileSync(path, 'utf8');
const before = schema;

// 1. The merged field on AgentCapabilityGrant (fresh generator output).
schema = schema.replace(
  /^(\s*)deniedBy(\s+)String\?\n\s*user\s+User\?\s+@relation\(fields: \[deniedBy\][^\n]*\n\s*grantedBy\s+String\?\n/m,
  (_match, indent) =>
    [
      `${indent}// Fixed by scripts/fix-auth-schema.mjs (the generator merges these links).`,
      `${indent}deniedBy      String?`,
      `${indent}deniedByUser  User?     @relation("AgentGrantDeniedBy", fields: [deniedBy], references: [id], onDelete: Cascade)`,
      `${indent}grantedBy     String?`,
      `${indent}grantedByUser User?     @relation("AgentGrantGrantedBy", fields: [grantedBy], references: [id], onDelete: Cascade)`,
      '',
    ].join('\n'),
);

// 2. User's single unnamed back-link -> two named back-links.
schema = schema.replace(
  /^(\s*)agentcapabilitygrants\s+AgentCapabilityGrant\[\]\s*\n/m,
  (_match, indent) =>
    schema.includes('agentGrantsGranted')
      ? ''
      : `${indent}agentGrantsGranted    AgentCapabilityGrant[] @relation("AgentGrantGrantedBy")\n` +
        `${indent}agentGrantsDenied     AgentCapabilityGrant[] @relation("AgentGrantDeniedBy")\n`,
);

if (schema !== before) {
  writeFileSync(path, schema);
  console.log('fix-auth-schema: repaired AgentCapabilityGrant relations');
}
