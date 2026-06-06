// Reference: spec/10_backend_architecture.md — Repository Architecture
// Reference: execution/02_phase_1_foundation.md — Deliverable 2 (Database Foundation)
//
// Mocks @prisma/client before any import resolves it so PrismaClient is replaced
// with a plain class whose lifecycle methods are jest.fn() instances.
// Tests are pure — no database connection, no network, no NestJS application bootstrap.

jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calls $connect exactly once on module init', async () => {
    await service.onModuleInit();
    expect(service.$connect).toHaveBeenCalledTimes(1);
  });

  it('calls $disconnect exactly once on module destroy', async () => {
    await service.onModuleDestroy();
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });
});
