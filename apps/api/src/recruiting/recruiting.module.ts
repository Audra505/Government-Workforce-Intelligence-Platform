import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { CandidateController } from './candidate.controller';
import { CandidateService } from './candidate.service';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import { InterviewController } from './interview.controller';
import { InterviewService } from './interview.service';
import { OfferController } from './offer.controller';
import { OfferService } from './offer.service';
import { HireController } from './hire.controller';
import { HireService } from './hire.service';

// PrismaService and AuditService are provided by PrismaModule (@Global) and AuditModule (@Global)
// respectively — they do not need to be listed as providers here.
// IdentityModule is imported so JwtAuthGuard and RolesGuard can resolve JwtStrategy and Reflector.

@Module({
  imports: [IdentityModule],
  controllers: [CandidateController, ApplicationController, InterviewController, OfferController, HireController],
  providers: [CandidateService, ApplicationService, InterviewService, OfferService, HireService],
})
export class RecruitingModule {}
