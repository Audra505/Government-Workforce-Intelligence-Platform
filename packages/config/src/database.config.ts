// Database configuration interface
// Reference: spec/10_backend_architecture.md — Configuration Architecture
// Reference: spec/05_database_schema.md — Tenant Strategy (DATABASE_URL points to gov_workforce_dev)
// Populated by: apps/api/src/config/database.config.ts (registerAs factory)

export interface DatabaseConfig {
  url: string;
}
