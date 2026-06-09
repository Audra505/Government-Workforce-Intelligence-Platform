// Reference: spec/01_requirements.md — FR-001 User Registration
// Reference: spec/06_api_contracts.md — POST /api/v1/users
// Reference: spec/07_security_architecture.md — Password Rules
//
// Phase 1 deviation from spec/06_api_contracts.md:
//   The spec contract has no password field — it anticipates an invitation/activation email flow.
//   NotificationModule (D-011 / FR-700) is not yet built; activation email is deferred.
//   The `password` field is a Phase 1 operational substitute.
//   Remove this field and the deviation note when the activation flow is implemented.
//
// Phase 1 password lifecycle limitations (deferred — no DB schema support):
//   - Force password change on first login
//   - Password reset required flag
//   - Temporary password expiration
//   - Common password prohibition (requires lookup service)
//   - Previously used password prohibition (requires password history table)

import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import {
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_REGEX,
} from '../../identity/constants/password-policy';

export class CreateUserDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({ example: 'jane.smith@agency.gov' })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: [String], example: ['<role-uuid>'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds!: string[];

  // Phase 1 deviation — see file header.
  @ApiProperty({ example: 'TempPass1234!' })
  @IsString()
  @MinLength(12)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}
