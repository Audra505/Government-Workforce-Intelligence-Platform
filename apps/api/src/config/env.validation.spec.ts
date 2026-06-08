import { validate } from './env.validation';

// Reference: spec/10_backend_architecture.md — Configuration Architecture
// Reference: spec/07_security_architecture.md — SEC-007: Secrets Management
// Tests the environment validation gate that runs at application startup.
// All tests are pure — no I/O, no NestJS context, no database connection.

describe('Environment Validation', () => {
  describe('DATABASE_URL', () => {
    it('accepts a valid DATABASE_URL', () => {
      const result = validate({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        JWT_SECRET: 'test-jwt-secret',
      });
      expect(result.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
    });

    it('throws when DATABASE_URL is absent', () => {
      expect(() => validate({})).toThrow('Environment validation failed');
    });

    it('throws when DATABASE_URL is an empty string', () => {
      expect(() => validate({ DATABASE_URL: '' })).toThrow('Environment validation failed');
    });
  });

  describe('PORT', () => {
    it('defaults PORT to 3001 when absent', () => {
      const result = validate({ DATABASE_URL: 'postgresql://localhost/db', JWT_SECRET: 'test-jwt-secret' });
      expect(result.PORT).toBe(3001);
    });

    it('accepts a valid PORT', () => {
      const result = validate({
        DATABASE_URL: 'postgresql://localhost/db',
        JWT_SECRET: 'test-jwt-secret',
        PORT: '4000',
      });
      expect(result.PORT).toBe(4000);
    });

    it('throws when PORT is below minimum (0)', () => {
      expect(() =>
        validate({ DATABASE_URL: 'postgresql://localhost/db', PORT: '0' }),
      ).toThrow('Environment validation failed');
    });

    it('throws when PORT exceeds maximum (65536)', () => {
      expect(() =>
        validate({ DATABASE_URL: 'postgresql://localhost/db', PORT: '65536' }),
      ).toThrow('Environment validation failed');
    });
  });

  describe('NODE_ENV', () => {
    it('defaults NODE_ENV to development when absent', () => {
      const result = validate({ DATABASE_URL: 'postgresql://localhost/db', JWT_SECRET: 'test-jwt-secret' });
      expect(result.NODE_ENV).toBe('development');
    });

    it('accepts NODE_ENV when provided', () => {
      const result = validate({
        DATABASE_URL: 'postgresql://localhost/db',
        JWT_SECRET: 'test-jwt-secret',
        NODE_ENV: 'production',
      });
      expect(result.NODE_ENV).toBe('production');
    });
  });

  describe('full valid config', () => {
    it('accepts all required and optional vars together', () => {
      const result = validate({
        DATABASE_URL: 'postgresql://govplatform:devpassword@localhost:5432/gov_workforce_dev',
        JWT_SECRET: 'test-jwt-secret',
        PORT: '3001',
        NODE_ENV: 'development',
      });
      expect(result.DATABASE_URL).toBe(
        'postgresql://govplatform:devpassword@localhost:5432/gov_workforce_dev',
      );
      expect(result.PORT).toBe(3001);
      expect(result.NODE_ENV).toBe('development');
    });
  });
});
