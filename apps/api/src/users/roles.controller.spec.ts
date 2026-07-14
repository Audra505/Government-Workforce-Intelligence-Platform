// Reference: governance/GD-M26-1.md — Decision 2 (GET /api/v1/roles)
// Reference: governance/GD-M26-1.md — Decision 10 (Backend Test Requirements)
//
// Pure unit tests — no HTTP server, no guards, no database.
// UsersService is replaced with a jest.fn() mock.
// JwtAuthGuard and RolesGuard are overridden to always pass.
// Verifies: response envelope shape, service delegation, role filtering delegation.

import { Test, type TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RolesGuard } from '../identity/roles.guard';
import { RolesController } from './roles.controller';
import { UsersService } from './users.service';
import type { RequestUser } from '../identity/jwt.strategy';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const SA_ACTOR: RequestUser = {
  userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  email: 'admin@dev.gov',
  roles: ['System Administrator'],
};

const HRD_ACTOR: RequestUser = {
  userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  email: 'hr@dev.gov',
  roles: ['HR Director'],
};

const ALL_SEVEN_ROLES = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Compliance Officer' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Executive User' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Hiring Manager' },
  { id: '44444444-4444-4444-8444-444444444444', name: 'HR Director' },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Recruiter' },
  { id: '66666666-6666-4666-8666-666666666666', name: 'System Administrator' },
  { id: '77777777-7777-4777-8777-777777777777', name: 'Workforce Planner' },
];

const SIX_ROLES_FOR_HRD = ALL_SEVEN_ROLES.filter(r => r.name !== 'System Administrator');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RolesController', () => {
  let controller: RolesController;
  let mockUsersService: { getRoles: jest.Mock };

  beforeEach(async () => {
    mockUsersService = { getRoles: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RolesController>(RolesController);
  });

  afterEach(() => jest.clearAllMocks());

  // --------------------------------------------------------------------------
  // GET / — getRoles()
  // --------------------------------------------------------------------------

  describe('getRoles()', () => {
    it('returns { success: true, data: { roles: [...] } }', async () => {
      mockUsersService.getRoles.mockResolvedValue(ALL_SEVEN_ROLES);

      const result = await controller.getRoles(SA_ACTOR) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect((result['data'] as Record<string, unknown>)['roles']).toEqual(ALL_SEVEN_ROLES);
    });

    it('delegates to usersService.getRoles with actor.roles', async () => {
      mockUsersService.getRoles.mockResolvedValue(ALL_SEVEN_ROLES);

      await controller.getRoles(SA_ACTOR);

      expect(mockUsersService.getRoles).toHaveBeenCalledWith(['System Administrator']);
    });

    it('SA actor — service returns 7 roles and controller wraps them unchanged', async () => {
      mockUsersService.getRoles.mockResolvedValue(ALL_SEVEN_ROLES);

      const result = await controller.getRoles(SA_ACTOR) as Record<string, Record<string, unknown>>;

      const roles = result['data']!['roles'] as unknown[];
      expect(roles).toHaveLength(7);
    });

    it('HRD actor — controller passes HRD roles to service and wraps result unchanged', async () => {
      mockUsersService.getRoles.mockResolvedValue(SIX_ROLES_FOR_HRD);

      const result = await controller.getRoles(HRD_ACTOR) as Record<string, Record<string, unknown>>;

      expect(mockUsersService.getRoles).toHaveBeenCalledWith(['HR Director']);
      const roles = result['data']!['roles'] as unknown[];
      expect(roles).toHaveLength(6);
    });

    it('each role item has id and name properties', async () => {
      mockUsersService.getRoles.mockResolvedValue(ALL_SEVEN_ROLES);

      const result = await controller.getRoles(SA_ACTOR) as Record<string, Record<string, unknown>>;

      const roles = result['data']!['roles'] as Array<{ id: string; name: string }>;
      for (const role of roles) {
        expect(typeof role.id).toBe('string');
        expect(typeof role.name).toBe('string');
      }
    });
  });
});
