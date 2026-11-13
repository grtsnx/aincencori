import { describe, expect, it, vi } from 'vitest';
import { AdminService } from '@/modules/admin/admin.service.js';

function setup(options: { failCreate?: unknown } = {}) {
  const organization = {
    id: 'org_staff',
    slug: 'staff',
    name: 'Staff',
  };
  let storedOrganization: typeof organization | null = null;
  const members = new Set<string>();
  const findUnique = vi.fn(async () => storedOrganization);
  const createOrganization = vi.fn(async () => {
    if (options.failCreate) {
      if ((options.failCreate as { code?: string }).code === 'P2002') {
        storedOrganization = organization;
      }
      throw options.failCreate;
    }
    if (storedOrganization) throw { code: 'P2002' };
    storedOrganization = organization;
  });
  const findUniqueOrThrow = vi.fn(async () => {
    if (!storedOrganization) throw new Error('organization missing');
    return storedOrganization;
  });
  const findFirst = vi.fn(async ({ where }: { where: { userId: string } }) =>
    members.has(where.userId) ? { id: `member_${where.userId}` } : null,
  );
  const addMember = vi.fn(async ({ body }: { body: { userId: string } }) => {
    if (members.has(body.userId)) throw { code: 'P2002' };
    members.add(body.userId);
  });
  const api = {
    createOrganization,
    addMember,
    listMembers: vi.fn(async () => ({ members: [] })),
    hasPermission: vi.fn(async () => ({ success: true })),
  };
  const betterAuth = { auth: { api } } as never;
  const prisma = {
    db: {
      organization: { findUnique, findUniqueOrThrow },
      member: { findFirst },
    },
  } as never;
  const service = new AdminService(betterAuth, prisma);
  const auth = { user: { id: 'admin_1', role: 'admin' } } as never;

  return {
    service,
    auth,
    api,
    createOrganization,
    addMember,
    members,
    setStoredOrganization: (value: typeof organization | null) => {
      storedOrganization = value;
    },
  };
}

describe('AdminService staff organization bootstrap', () => {
  it('converges concurrent admin requests on one organization and membership', async () => {
    const { service, auth, createOrganization, addMember, members } = setup();

    await Promise.all([
      service.listStaff(auth, {}),
      service.listStaff(auth, {}),
    ]);

    expect(createOrganization).toHaveBeenCalledTimes(1);
    expect(addMember).toHaveBeenCalledTimes(1);
    expect(members.has('admin_1')).toBe(true);
  });

  it('propagates non-unique organization creation failures', async () => {
    const failure = new Error('database unavailable');
    const { service, auth, createOrganization } = setup({
      failCreate: failure,
    });

    await expect(service.listStaff(auth, {})).rejects.toBe(failure);
    expect(createOrganization).toHaveBeenCalledTimes(1);
  });

  it('recovers from another instance creating the organization first', async () => {
    const { service, auth, addMember, members } = setup({
      failCreate: { code: 'P2002' },
    });

    await expect(service.listStaff(auth, {})).resolves.toEqual([]);
    expect(addMember).toHaveBeenCalledTimes(1);
    expect(members.has('admin_1')).toBe(true);
  });
});
