// Reference: spec/07_security_architecture.md — Access Token: 1 Hour
//
// Single source of truth for JWT access token lifetime.
// Consumed by JwtModule (signOptions.expiresIn) and AuthService (login response expiresIn).
// Changing this value updates both consumers automatically.
// jsonwebtoken interprets a raw integer as a count of seconds.
export const JWT_ACCESS_EXPIRES_IN_SECONDS = 3600;

// Reference: spec/07_security_architecture.md — Password Rules (hashing cost factor).
// Consumed by UsersService.createUser() for new account passwords.
// Note: prisma/seed.ts (dev fixture) also uses 12 rounds — update both if this value changes.
export const BCRYPT_ROUNDS = 12;
