import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Reference: spec/06_api_contracts.md — POST /api/v1/auth/login request body
// Reference: spec/07_security_architecture.md — Password Rules, Account Lockout
//
// @MaxLength(254): RFC 5321 maximum email address length; aligns with identity.users.email VarChar(255).
// @MaxLength(1000): prevents bcrypt DoS via extremely long password strings.
// No @MinLength on password: complexity rules apply at creation, not at login.
// No tenantId field: derived from JWT post-login; never supplied by client (approved Phase 1 design).

export class LoginDto {
  @ApiProperty({ example: 'user@example.gov' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '********' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  password!: string;
}
