import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Public } from '@core/auth/decorators/public.decorator';
import { SkipIntegrity } from '@core/integrity/skip-integrity.decorator';
import { DiagnosticsEnabledGuard } from '@core/http/diagnostics-enabled.guard';
import {
  AppIntegrityMetrics,
  IntegrityMetricsSnapshot,
} from '../application/app-integrity.metrics';
import { AppIntegrityService } from '../application/app-integrity.service';

export class IssueChallengeDto {
  @ApiProperty({ description: 'Device identifier supplied by the mobile app.', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'deviceId must not be blank' })
  @MaxLength(100)
  deviceId!: string;
}

export class RegisterAttestationDto extends IssueChallengeDto {
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
 * Every route here is public — no JWT and no attestation headers. The app
 * attests on launch, before anyone has logged in, so a session cannot be a
 * precondition; and a device cannot prove itself before it has registered, so
 * requiring a challenge in order to get a challenge would never terminate.
 * What stands in for authentication is the attestation itself (Apple's
 * certificate chain, Google's signed verdict), a server-issued single-use
 * challenge tied to the device, and the gateway's per-IP throttle.
 */
@ApiTags('app-integrity')
@SkipIntegrity()
@Controller('app-integrity')
export class AppIntegrityController {
  constructor(
    private readonly service: AppIntegrityService,
    private readonly metrics: AppIntegrityMetrics,
  ) {}

  /**
   * What enforcement WOULD have refused, counted.
   *
   * The rollout plan is "run in `observe`, read the numbers, then switch",
   * and a warning line per request does not produce a number — there is no
   * log aggregation in this deployment. Behind the diagnostics switch (404
   * when it is off) like every other observability route: the reasons name
   * which check a client failed.
   */
  @Public()
  @UseGuards(DiagnosticsEnabledGuard)
  @Get('metrics')
  @ApiExcludeEndpoint()
  metricsSnapshot(): IntegrityMetricsSnapshot {
    return this.metrics.snapshot();
  }

  /**
   * A one-time nonce. Both platforms need one - iOS to attest and to assert,
   * Android only if you choose to bind the token to a server value rather than
   * to the request body.
 */
  @Public()
  @Post('challenge')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Issue a one-time attestation challenge for a device (no JWT required)',
    operationId: 'appIntegrity_challenge',
  })
  @ApiOkResponse({ schema: { example: { challenge: 'q1w2e3...' } } })
  async challenge(@Body() dto: IssueChallengeDto) {
    return { challenge: await this.service.issueChallenge(dto.deviceId) };
  }

  /**
   * iOS one-time registration, before login. The key is recorded against the
   * device and claimed by the first user who signs a request with it. Android
   * has no equivalent: its token is self-contained and nothing is stored.
 */
  @Public()
  @Post('ios/register')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register an App Attest key (iOS, once per install, no JWT required)',
    operationId: 'appIntegrity_registerIos',
  })
  @ApiOkResponse({ schema: { example: { status: 'success', message: 'Device attested.' } } })
  async registerIos(@Body() dto: RegisterAttestationDto) {
    const verdict = await this.service.registerIosKey(dto);
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
   *
   * Public like the rest of the controller: the app checks itself on launch,
   * before login. Each call costs one Google API round trip, so the gateway
   * throttles it per IP.
 */
  @Public()
  @Post('android/verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check a Play Integrity token (Android, development aid, no JWT required)',
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
