import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Phase 1 Foundation — minimal bootstrap
// ValidationPipe, global prefix, Swagger, and guards added in Milestone 3 (Backend Foundation)
// References: execution/02_phase_1_foundation.md — Deliverable 3
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap();
