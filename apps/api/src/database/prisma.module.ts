import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Reference: spec/10_backend_architecture.md — Repository Architecture
//
// @Global() makes PrismaService available throughout the application without
// requiring other modules to import PrismaModule explicitly.
// AppModule imports this once; all future modules (AuditModule M4,
// IdentityModule M6, domain modules M7+) inject PrismaService directly.

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
