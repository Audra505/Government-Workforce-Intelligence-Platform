import {
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

// Reference: spec/06_api_contracts.md — POST /api/v1/auth/login, POST /api/v1/auth/logout, GET /api/v1/auth/me
// Reference: spec/07_security_architecture.md — Authentication Flow, SEC-003 Tenant Isolation
// Reference: directives/08_audit_rules.md — AUD-200 through AUD-210
//
// AuthController is the sole HTTP transport layer for authentication.
// It maps LoginResult discriminated union → HTTP status codes + response envelopes.
// It does not call AuditService — all audit events are emitted inside AuthService.
// tenantId is never accepted as input; it is always derived from the validated JWT.
//
// URI versioning (version: '1') is included now.
// The /api/v1/ prefix activates when app.enableVersioning() is wired in Step 8 (main.ts).
// Before Step 8 the routes are accessible at /api/auth/*.

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequestUser } from './jwt.strategy';

@ApiTags('auth')
@Controller({ version: '1', path: 'auth' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: LoginResponseDto, description: 'Authentication successful' })
  @ApiResponse({ status: 400, description: 'Validation error — missing or malformed fields' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async login(@Body() dto: LoginDto): Promise<object> {
    const result = await this.authService.login(dto.email, dto.password);

    switch (result.outcome) {
      case 'SUCCESS':
        return {
          success: true,
          data: { accessToken: result.accessToken, expiresIn: result.expiresIn },
        };

      case 'UNAUTHORIZED':
        // User enumeration protection: EMAIL_NOT_FOUND, ACCOUNT_LOCKED, and INVALID_PASSWORD
        // all collapse to UNAUTHORIZED in AuthService. The identical 401 body here ensures
        // no information about which specific condition triggered the failure is disclosed.
        throw new UnauthorizedException({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        });

      case 'INTERNAL_ERROR':
        throw new InternalServerErrorException({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'An error occurred' },
        });
    }
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate the current session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async logout(@CurrentUser() user: RequestUser): Promise<object> {
    await this.authService.logout(user.userId, user.tenantId);
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  me(@CurrentUser() user: RequestUser): object {
    // tenantId intentionally omitted per spec/06_api_contracts.md — clients never
    // need to supply or reference their own tenantId; it is enforced server-side only.
    return {
      success: true,
      data: { id: user.userId, email: user.email, roles: user.roles },
    };
  }
}
