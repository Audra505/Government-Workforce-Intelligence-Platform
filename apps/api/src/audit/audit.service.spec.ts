// Reference: directives/08_audit_rules.md — AUD-100 (required event fields), AUD-1300 (failure suppression)
// Reference: spec/10_backend_architecture.md — Audit Architecture
// Reference: spec/07_security_architecture.md — SEC-007: sensitive data must not appear in logs
//
// Tests are pure — no database connection, no network, no NestJS application bootstrap.
// PrismaService is replaced with a jest.fn() mock; Logger is intercepted via prototype spy.

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../database/prisma.service';
import { AuditService, SYSTEM_USER_ID } from './audit.service';
import { AuditEventType } from './enums/audit-event-type.enum';

describe('AuditService', () => {
  let service: AuditService;
  let mockPrisma: { auditEvent: { create: jest.Mock } };
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockPrisma = { auditEvent: { create: jest.fn().mockResolvedValue(undefined) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // Group 1: Instantiation
  // ---------------------------------------------------------------------------

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Group 2: Successful write path
  // ---------------------------------------------------------------------------

  it('logEvent() calls prisma.auditEvent.create() with the correct tenantId, userId, action, and result', async () => {
    await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: AuditEventType.AUTH_LOGIN_SUCCESS,
      result: 'SUCCESS',
    });

    expect(mockPrisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_SUCCESS,
        result: 'SUCCESS',
      }),
    });
  });

  it('logEvent() passes entityType and entityId when provided', async () => {
    await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: AuditEventType.WORKFORCE_POSITION_CREATED,
      result: 'SUCCESS',
      entityType: 'Position',
      entityId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    });

    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'Position',
        entityId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      }),
    });
  });

  it('logEvent() passes undefined for entityType and entityId when omitted', async () => {
    await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: AuditEventType.AUTH_LOGOUT,
      result: 'SUCCESS',
    });

    const { data } = mockPrisma.auditEvent.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data['entityType']).toBeUndefined();
    expect(data['entityId']).toBeUndefined();
  });

  it('logEvent() passes metadata when provided', async () => {
    const metadata = { actorType: 'USER' as const, ipAddress: '10.0.0.1' };

    await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: AuditEventType.AUTH_LOGIN_SUCCESS,
      result: 'SUCCESS',
      metadata,
    });

    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata }),
    });
  });

  it('logEvent() resolves without a return value on success', async () => {
    const result = await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: AuditEventType.AUTH_LOGIN_SUCCESS,
      result: 'SUCCESS',
    });

    expect(result).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Group 3: AUD-1300 failure suppression
  // ---------------------------------------------------------------------------

  it('logEvent() does not throw when prisma.auditEvent.create() rejects (AUD-1300)', async () => {
    mockPrisma.auditEvent.create.mockRejectedValue(new Error('DB write failed'));

    await expect(
      service.logEvent({
        tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        action: AuditEventType.AUTH_LOGIN_FAILURE,
        result: 'FAILURE',
      }),
    ).resolves.toBeUndefined();
  });

  it('logEvent() calls logger.error exactly once when prisma.auditEvent.create() rejects', async () => {
    mockPrisma.auditEvent.create.mockRejectedValue(new Error('DB write failed'));

    await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: AuditEventType.AUTH_LOGIN_FAILURE,
      result: 'FAILURE',
    });

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Group 4: Sensitive-data logging restriction
  // ---------------------------------------------------------------------------

  it('logEvent() does not include userId, entityId, or metadata in the error log message', async () => {
    const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const entityId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const sensitiveIp = '192.168.99.1';

    mockPrisma.auditEvent.create.mockRejectedValue(new Error('DB write failed'));

    await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId,
      action: AuditEventType.AUTH_LOGIN_SUCCESS,
      result: 'SUCCESS',
      entityId,
      metadata: { ipAddress: sensitiveIp },
    });

    const loggedMessage = loggerErrorSpy.mock.calls[0][0] as string;
    expect(loggedMessage).not.toContain(userId);
    expect(loggedMessage).not.toContain(entityId);
    expect(loggedMessage).not.toContain(sensitiveIp);
    // action and tenantId are permitted in the log message per service implementation
    expect(loggedMessage).toContain(AuditEventType.AUTH_LOGIN_SUCCESS);
    expect(loggedMessage).toContain('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  // ---------------------------------------------------------------------------
  // Group 5: SYSTEM_USER_ID constant
  // ---------------------------------------------------------------------------

  it('SYSTEM_USER_ID is the zero UUID sentinel', () => {
    expect(SYSTEM_USER_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  // ---------------------------------------------------------------------------
  // Group 6: Result field coverage
  // ---------------------------------------------------------------------------

  it('logEvent() correctly writes a FAILURE result', async () => {
    await service.logEvent({
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      action: AuditEventType.AUTHZ_ACCESS_DENIED,
      result: 'FAILURE',
    });

    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ result: 'FAILURE' }),
    });
  });
});
