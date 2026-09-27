import { Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '@core/auth/decorators/public.decorator';
import { ProxyService } from '../proxy/proxy.service';

/**
 * The pre-login Sanaad auth journey (framework v1.0.0), forwarded verbatim to
 * HMC_BackEnd — same routes, same request/response bodies, only relayed
 * through this gateway. All are @Public() (no bearer token exists yet).
 * The MPIN/OTP-attempt endpoints are additionally rate-limited here
 * (5 req/min per IP by default — see ThrottlerModule in CoreModule) since
 * they are the brute-force surface of the login flow.
 * `GET /auth/me` is intentionally NOT declared here — it requires a bearer
 * token and is served by the generic ProxyController like any other
 * authenticated route.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly proxy: ProxyService) {}

  @Public()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Post('initiate')
  @ApiOperation({
    summary: 'API-2 — User Validate (LDAP + send OTP)',
    operationId: 'auth_initiate',
  })
  initiate(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  /** Standalone OTP send (MOTC push-table insert) — throttled: SMS-spam surface. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('send-otp')
  @ApiOperation({
    summary: 'Send OTP — generate + store in MOTC_SMS_PushTable',
    operationId: 'auth_sendOtp',
  })
  sendOtp(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('otp/validate')
  @ApiOperation({ summary: 'API-3 — Validate OTP', operationId: 'auth_validateOtp' })
  validateOtp(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  @Public()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Post('mpin/update')
  @ApiOperation({ summary: 'API-4 — Set MPIN (first-time)', operationId: 'auth_setMpin' })
  setMpin(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('login')
  @ApiOperation({
    summary: 'API-5 — Login (MPIN → JWT + functionAccessList)',
    operationId: 'auth_login',
  })
  login(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('mpin/forgot')
  @ApiOperation({
    summary: 'API-6 — Initiate Forgot MPIN (send OTP)',
    operationId: 'auth_forgotMpin',
  })
  forgotMpin(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('mpin/update/reset')
  @ApiOperation({ summary: 'API-7 — Reset MPIN (OTP + new MPIN)', operationId: 'auth_resetMpin' })
  resetMpin(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  /**
   * @Public + throttled: refresh happens when the access token is already
   * expired, so the gateway must not demand a valid bearer here. The backend
   * fully verifies the refresh token (signature/expiry/typ/revocation) and
   * rotates it. `/auth/logout` is intentionally NOT declared here — it
   * requires a live bearer token and flows through the generic ProxyController
   * like any other authenticated route.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('token/refresh')
  @ApiOperation({
    summary: 'Exchange a refresh token for a new access + refresh pair',
    operationId: 'auth_refreshToken',
  })
  refreshToken(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }
}
