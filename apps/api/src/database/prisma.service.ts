import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Reference: spec/10_backend_architecture.md — Repository Architecture (Prisma)
// Reference: spec/07_security_architecture.md — SEC-007: never log DATABASE_URL
//
// PrismaClient reads DATABASE_URL from process.env automatically.
// ConfigModule.validate() has already confirmed it is present before this module initialises.
// The connection string is never referenced or logged here.

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
