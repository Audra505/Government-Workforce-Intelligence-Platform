// =============================================================================
// Database Seed — Authoritative Role Set + Development Fixture
// Milestone 2: Database Foundation (roles)
// Milestone 5: Authentication Foundation (dev seed user)
// Reference: directives/10_role_based_access_rules.md, execution/02_phase_1_foundation.md
// =============================================================================
// All upserts are idempotent — safe to run multiple times.
//
// Dev seed user section (NODE_ENV=development only):
// - Creates Development Agency tenant and admin user for local login testing
// - Recovery-oriented: every run resets passwordHash, failedLoginAttempts,
//   lockedUntil, and status to known-good values
// - Allowlist guard: skipped in all non-development environments by default
// =============================================================================

import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Dev-only fixture constants — not used outside NODE_ENV=development
const DEV_SEED_EMAIL = 'admin@dev.gov';
const DEV_SEED_PASSWORD = 'DevAdmin1234!';
const DEV_SEED_FIRST_NAME = 'Dev';
const DEV_SEED_LAST_NAME = 'Admin';
const DEV_SEED_ROLE = 'System Administrator';
const DEV_TENANT_NAME = 'Development Agency';
const DEV_TENANT_CODE = 'DEV';

export const PLATFORM_ROLES = [
  {
    name: 'System Administrator',
    description: 'Full platform access and system configuration across all tenants',
  },
  {
    name: 'HR Director',
    description: 'Workforce management, policy oversight, and strategic HR decisions within a tenant',
  },
  {
    name: 'Workforce Planner',
    description: 'Forecasting, position management, and vacancy planning',
  },
  {
    name: 'Recruiter',
    description: 'Candidate management and hiring workflow execution',
  },
  {
    name: 'Hiring Manager',
    description: 'Interview management and hiring decisions within their department',
  },
  {
    name: 'Compliance Officer',
    description: 'Policy compliance oversight and audit review',
  },
  {
    name: 'Executive User',
    description: 'Executive reporting and workforce intelligence dashboards',
  },
] as const;

async function seedDevUser(): Promise<void> {
  // Allowlist safeguard: unknown/unset environments default to safe (skip)
  if (process.env['NODE_ENV'] !== 'development') {
    console.log('\nDev user seed skipped — not in development environment.');
    return;
  }

  console.log('\nSeeding development fixture user...');

  const tenant = await prisma.tenant.upsert({
    where: { code: DEV_TENANT_CODE },
    update: {},
    create: {
      name: DEV_TENANT_NAME,
      code: DEV_TENANT_CODE,
      status: 'ACTIVE',
    },
  });
  console.log(`  [OK] Tenant: ${tenant.name} (${tenant.id})`);

  // 12 rounds — consistent with spec/07_security_architecture.md and IdentityService
  // Recovery-oriented: computed every run and applied in update clause to restore known-good state
  const passwordHash = await bcrypt.hash(DEV_SEED_PASSWORD, 12);

  // update clause resets auth state so re-seeding always restores a working account
  // regardless of lockout testing, status mutation, or manual DB changes
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: DEV_SEED_EMAIL } },
    update: {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      status: 'ACTIVE',
    },
    create: {
      tenantId: tenant.id,
      email: DEV_SEED_EMAIL,
      passwordHash,
      firstName: DEV_SEED_FIRST_NAME,
      lastName: DEV_SEED_LAST_NAME,
      status: 'ACTIVE',
      failedLoginAttempts: 0,
    },
  });
  console.log(`  [OK] User: ${user.email} (${user.id})`);

  // Role seed runs before this function in main() — findUniqueOrThrow surfaces a missing role clearly
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: DEV_SEED_ROLE },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });
  console.log(`  [OK] Role assigned: ${role.name}`);

  console.log(`\nDev fixture ready. Login: ${DEV_SEED_EMAIL} / ${DEV_SEED_PASSWORD}`);
}

async function main(): Promise<void> {
  console.log('Seeding platform roles...');

  for (const role of PLATFORM_ROLES) {
    const result = await prisma.role.upsert({
      where: { name: role.name },
      update: {},
      create: role,
    });
    console.log(`  [OK] ${result.name}`);
  }

  const count = await prisma.role.count();
  console.log(`\nSeed complete. ${count} roles in identity.roles.`);

  await seedDevUser();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
