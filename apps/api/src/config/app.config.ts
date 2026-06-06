import { registerAs } from '@nestjs/config';

// Reference: spec/10_backend_architecture.md — Configuration Architecture
// Namespace 'app' — access via configService.get('app') or configService.get<AppConfig>('app')
// AppConfig interface is defined in packages/config for external consumers (apps/web, spec files).
// Not imported here: path-alias cross-package imports conflict with tsconfig.build.json rootDir.

export default registerAs('app', () => ({
  port: parseInt(process.env['PORT'] ?? '3001', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
}));
