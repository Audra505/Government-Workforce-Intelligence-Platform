import { ApiProperty } from '@nestjs/swagger';

// Reference: spec/06_api_contracts.md — POST /api/v1/auth/login response contract

export class LoginResponseDataDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ example: 3600, description: 'Token lifetime in seconds' })
  expiresIn!: number;
}

export class LoginResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: LoginResponseDataDto })
  data!: LoginResponseDataDto;
}
