// Application configuration interface
// Reference: spec/10_backend_architecture.md — Configuration Architecture
// Populated by: apps/api/src/config/app.config.ts (registerAs factory)
// Milestone 6 addition: no auth-related fields at this stage

export interface AppConfig {
  port: number;
  nodeEnv: string;
}
