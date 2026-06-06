import { plainToInstance } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

// Reference: spec/10_backend_architecture.md — Configuration Architecture
// Reference: spec/07_security_architecture.md — SEC-007: Secrets Management
//
// Called once by ConfigModule.forRoot({ validate }) before application bootstrap.
// Startup is aborted immediately if any required variable fails validation.
//
// JWT_SECRET / JWT_REFRESH_SECRET are intentionally absent from this schema.
// They are empty in .env until Milestone 6 (Authentication). Adding them here
// with @IsString() would crash startup now; adding with @IsOptional() would
// silently permit an invalid auth configuration later. They will be added with
// @IsString() (required, no default) when Milestone 6 wires the auth module.

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @IsOptional()
  @IsString()
  NODE_ENV: string = 'development';
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('\n')}`,
    );
  }

  return validated;
}
