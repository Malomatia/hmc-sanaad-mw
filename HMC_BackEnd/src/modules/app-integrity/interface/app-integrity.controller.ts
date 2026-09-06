import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { SkipIntegrity } from '@core/integrity/skip-integrity.decorator';
import { AppIntegrityService } from '../application/app-integrity.service';

export class RegisterAttestationDto {
  @ApiProperty({ description: 'Key identifier returned by DCAppAttestService.generateKey().' })
  @IsString()
  @IsNotEmpty()
  keyId!: string;

  @ApiProperty({ description: 'Base64 of the attestation object from attestKey().' })
  @IsString()
  @IsNotEmpty()
  attestation!: string;

  @ApiProperty({ description: 'The challenge this attestation was produced for.' })
  @IsString()
  @IsNotEmpty()
  challenge!: string;
}

export class VerifyAndroidTokenDto {
  @ApiProperty({ description: 'Token from requestStandardPlayIntegrityToken().' })
  @IsString()
  @IsNotEmpty()
  integrityToken!: string;

  @ApiPropertyOptional({
    description:
      'The SHA-256 the app computed over its request body. Send it to check that half too — ' +
      'it is what stops a genuine token being reused on a different request.',
  })
  @IsOptional()
  @IsString()
  requestHash?: string;
}

/**
 * Device attestation setup.
 *
 * Both routes are exempt from the integrity guard itself â€” a device cannot
 * prove itself before it has registered, and requiring a challenge in order to
 * get a challenge would never terminate.
 */
@ApiTags('app-integrity')
@ApiBearerAuth()
@SkipIntegrity()
@Controller('app-integrity')
export class AppIntegrityController {
  constructor(private readonly service: AppIntegrityService) {}

  /**
   * A one-time nonce. Both platforms need one â€” iOS to attest and to assert,
   * Android only if you choose to bind the token to a server value rather than
   * to the request body.
   */
  @Get('challenge')
  @ApiOperation({
    summary: 'Issue a one-time attestation challenge',
    operationId: 'appIntegrity_challenge',
  })
  @ApiOkResponse({ schema: { example: { challenge: 'q1w2e3...', expiresInMs: 300000 } } })
  async challenge(@CurrentUser() user: AuthenticatedUser) {
    return { challenge: await this.service.issueChallenge(user.username) };
  }

  /**
   * iOS one-time registration. Android has no equivalent: its token is
   * self-contained and nothing is stored.
   */
  @Post('ios/register')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register an App Attest key (iOS, once per install)',
    operationId: 'appIntegrity_registerIos',
  })
  @ApiOkResponse({ schema: { example: { status: 'success', message: 'Device attested.' } } })
  async registerIos(
    @Body() dto: RegisterAttestationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const verdict = await this.service.registerIosKey({ ...dto, username: user.username });
    // The reason is deliberately not returned: it would tell a probing client
    // exactly which check to defeat next. It is in the server log.
    return verdict.ok
      ? { message: 'Device attested.' }
      : { message: 'Attestation could not be verified.', verified: false };
  }

  /**
   * Android self-check — a development tool, NOT the enforcement path.
   *
   * In production the token travels as a header on the real request and the
   * guard verifies it there; calling this first would make every action two
   * round trips. It exists because attestation ships in `off` mode, so an app
   * can send a completely invalid token and nothing says so until the day
   * enforcement is switched on and everything fails at once.
   *
   * Unlike the iOS route this registers nothing — Android has no key to store,
   * which is why it has no `register` — and unlike the guard it reports
   * Google's verdicts so a failure can be acted on: `UNRECOGNIZED_VERSION`
   * means a build that did not come from Play, `MEETS_BASIC_INTEGRITY` alone
   * means a rooted or emulated device.
   */
  @Post('android/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check a Play Integrity token (Android, development aid)',
    operationId: 'appIntegrity_verifyAndroid',
  })
  @ApiOkResponse({
    schema: {
      example: {
        verified: true,
        verdicts: {
          appRecognitionVerdict: 'PLAY_RECOGNIZED',
          deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
          appLicensingVerdict: 'LICENSED',
          packageName: 'com.hmc.sanaad',
        },
      },
    },
  })
  async verifyAndroid(@Body() dto: VerifyAndroidTokenDto) {
    const verdict = await this.service.verifyAndroidToken(dto.integrityToken, dto.requestHash);
    // The reason IS returned here — the whole point is to tell the developer
    // what to fix. The guard stays silent; this is not on the request path.
    return {
      verified: verdict.ok,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      ...(verdict.details ? { verdicts: verdict.details } : {}),
    };
  }
}
