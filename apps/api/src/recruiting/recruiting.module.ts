import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { CandidateController } from './candidate.controller';
import { CandidateService } from './candidate.service';

// PrismaService and AuditService are provided by PrismaModule (@Global) and AuditModule (@Global)
// respectively — they do not need to be listed as providers here.
// IdentityModule is imported so JwtAuthGuard and RolesGuard can resolve JwtStrategy and Reflector.

@Module({
  imports: [IdentityModule],
  controllers: [CandidateController],
  providers: [CandidateService],
})
export class RecruitingModule {}
