import { Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '@core/auth/decorators/public.decorator';
import { ProxyService } from '../proxy/proxy.service';

/**
 * The attestation flow runs on app launch, BEFORE login, so none of these
 * routes can require a JWT; they are registered here, ahead of the
 * authenticated wildcard, and forwarded verbatim. What replaces the token as
 * a brake on abuse is a per-IP throttle: the two verification routes cost
 * real work downstream (a certificate-chain check, a Google API call) so they
 * get a tighter budget than challenge issuance.
 */
@ApiTags('app-integrity')
@Controller('app-integrity')
export class AppIntegrityController {
  constructor(private readonly proxy: ProxyService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(200)
  @Post('challenge')
  @ApiOperation({
    summary: 'Issue a one-time attestation challenge for a device (no JWT required)',
    operationId: 'appIntegrity_challenge',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['deviceId'],
      additionalProperties: false,
      properties: { deviceId: { type: 'string', minLength: 1, maxLength: 100 } },
    },
  })
  challenge(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('ios/register')
  @ApiOperation({
    summary: 'Register an App Attest key (iOS, once per install, no JWT required)',
    operationId: 'appIntegrity_registerIos',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['deviceId', 'keyId', 'attestation', 'challenge'],
      additionalProperties: false,
      properties: {
        deviceId: { type: 'string', minLength: 1, maxLength: 100 },
        keyId: { type: 'string', minLength: 1 },
        attestation: { type: 'string', minLength: 1, description: 'Base64 attestation object' },
        challenge: { type: 'string', minLength: 1 },
      },
    },
  })
  registerIos(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('android/verify')
  @ApiOperation({
    summary: 'Check a Play Integrity token (Android, development aid, no JWT required)',
    operationId: 'appIntegrity_verifyAndroid',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['integrityToken'],
      additionalProperties: false,
      properties: {
        integrityToken: { type: 'string', minLength: 1 },
        requestHash: { type: 'string', description: 'SHA-256 hex the app computed over its body' },
      },
    },
  })
  verifyAndroid(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }
}
