import { Logger, RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Reference: execution/02_phase_1_foundation.md — Deliverable 3 (Backend Foundation)
// Reference: spec/10_backend_architecture.md — Validation Strategy, Health Checks, API Documentation
// Reference: spec/07_security_architecture.md — SEC-004: Defense in Depth

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Global validation — strips and rejects unknown fields; auto-transforms primitive types
  // spec/10_backend_architecture.md: All external inputs validated via ValidationPipe + class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS — origin resolved from environment; credentials: true required for Authorization header.
  // CORS_ORIGIN must match the origin seen by the browser (http://localhost:3000 in local dev
  // and Docker Compose). Override via env var for staging/production without a code change.
  // Reference: spec/07_security_architecture.md — SEC-004: Defense in Depth
  app.enableCors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    credentials: true,
  });

  // Global route prefix with /health excluded
  // GET /health must remain at root path for Docker Compose healthcheck and load balancer probes
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  // URI versioning — inserts /v{n}/ between the global prefix and controller path
  // spec/06_api_contracts.md — API Versioning Strategy: /api/v1 current, /api/v2 for breaking changes
  // AuthController uses @Controller({ version: '1', path: 'auth' }) — resolves to /api/v1/auth/*
  // Controllers without a version annotation are unaffected.
  app.enableVersioning({
    type: VersioningType.URI,
  });

  // Swagger — gated on non-production per SEC-004 (Defense in Depth)
  // In production NODE_ENV, GET /api/docs returns 404 — API surface not exposed
  // createDocument is called after setGlobalPrefix so route paths include the /api prefix
  if (process.env['NODE_ENV'] !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Government Workforce Intelligence Platform')
      .setDescription(
        'Phase 1 Foundation API — workforce planning and intelligence for government agencies',
      )
      .setVersion('0.1.0')
      .addBearerAuth()  // activates @ApiBearerAuth() lock icons on protected routes (Step 7)
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger UI available at /api/docs');
  }

  // Port from validated namespaced config — already parsed as int by the app.config.ts factory
  // DATABASE_URL must not appear here or in any log line (SEC-007)
  const configService = app.get(ConfigService);
  const appCfg = configService.get<{ port: number; nodeEnv: string }>('app');
  const port = appCfg?.port ?? 3001;

  await app.listen(port);
  logger.log(`Application listening on port ${port} [${appCfg?.nodeEnv ?? 'development'}]`);
}

bootstrap();
