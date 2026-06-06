import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service';

// Reference: spec/10_backend_architecture.md — Health Checks (@nestjs/terminus)
// Reference: spec/07_security_architecture.md — SEC-007: never expose DATABASE_URL
//
// Raw Prisma errors frequently include the full connection string in their message.
// The catch clause deliberately omits the error binding (no `catch (e)`) so the
// raw error object cannot be accidentally forwarded to the HTTP response or logs.

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError(
        'database check failed',
        this.getStatus(key, false, { message: 'database unavailable' }),
      );
    }
  }
}
