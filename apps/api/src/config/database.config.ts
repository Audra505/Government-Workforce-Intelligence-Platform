import { registerAs } from '@nestjs/config';

// Reference: spec/10_backend_architecture.md — Configuration Architecture
// Reference: spec/07_security_architecture.md — SEC-007: never log DATABASE_URL
// Namespace 'database' — access via configService.get('database') or configService.get<DatabaseConfig>('database')
// DatabaseConfig interface is defined in packages/config for external consumers (apps/web, spec files).
// Not imported here: path-alias cross-package imports conflict with tsconfig.build.json rootDir.

export default registerAs('database', () => ({
  url: process.env['DATABASE_URL'] as string,
}));
