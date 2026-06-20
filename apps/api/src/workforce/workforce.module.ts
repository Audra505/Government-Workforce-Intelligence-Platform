// Reference: spec/01_requirements.md — FR-100 Position Management, FR-110 Employee Management,
//            FR-113 Skills Management, FR-114 Certifications Management
// Reference: spec/10_backend_architecture.md — Module Organization
// Reference: directives/02_position_management_rules.md — POS-AUTH-001 through POS-AUTH-005
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001 through EMP-AUTH-005
// Reference: directives/14_skill_management_rules.md — SKL-100 through SKL-103
// Reference: directives/15_certification_management_rules.md — CRT-100 through CRT-103
//
// WorkforceModule is not @Global() — domain service module, not a cross-cutting infrastructure provider.
// PrismaService and AuditService resolve from the global scope (@Global() providers).
// IdentityModule is imported to expose JwtAuthGuard and RolesGuard to all controller guard chains.
// RolesGuard requires Reflector via DI — resolved through IdentityModule's provider scope,
// matching the same pattern established in UsersModule and OrganizationModule.
//
// No exports: no service consumers outside this module in M13 Phase 2.
import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { PositionController } from './position.controller';
import { PositionService } from './position.service';
import { VacancyService } from './vacancy.service';
import { VacancyController } from './vacancy.controller';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';
import { EmployeeSkillService } from './employee-skill.service';
import { SkillController } from './skill.controller';
import { SkillService } from './skill.service';
import { CertificationController } from './certification.controller';
import { CertificationService } from './certification.service';

@Module({
  imports: [IdentityModule],
  controllers: [PositionController, VacancyController, EmployeeController, SkillController, CertificationController],
  providers: [PositionService, VacancyService, EmployeeService, EmployeeSkillService, SkillService, CertificationService],
})
export class WorkforceModule {}
