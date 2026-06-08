import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { validate } from './config/env.validation';
import { AuditModule } from './audit/audit.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';

// Reference: execution/02_phase_1_foundation.md — Deliverable 3 (Backend Foundation)
// Reference: spec/10_backend_architecture.md — Module Organization
//
// Module registration order follows dependency sequencing:
//   Milestone 3: ConfigModule (global), PrismaModule (global), HealthModule
//   Milestone 4: AuditModule (precedes Authentication — established before auth layer)
//   Milestone 5: IdentityModule (Authentication, RBAC)

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [appConfig, databaseConfig],
    }),
    PrismaModule,
    HealthModule,
    AuditModule,
    IdentityModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
