// =============================================================================
// Database Seed — Authoritative Role Set
// Milestone 2: Database Foundation
// Reference: directives/10_role_based_access_rules.md, execution/02_phase_1_foundation.md
// =============================================================================
// Seeds the 7 platform roles that are authoritative across all sessions.
// Uses upsert so the seed is safe to run multiple times (idempotent).
// =============================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
