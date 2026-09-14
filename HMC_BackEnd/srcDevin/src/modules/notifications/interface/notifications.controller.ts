import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DiagnosticsEnabledGuard } from '@core/http/diagnostics-enabled.guard';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { NotificationsService } from '../application/notifications.service';
import { RegisterDeviceTokenDto, UnregisterDeviceTokenDto } from './dto/device-token.dto';

/**
 * Push registration.
 *
 * The user is taken from the token, never from the body: a registration says
 * "send THIS person's notifications to THIS device", and letting a client name
 * the person would let it redirect someone else's notifications to its own
 * handset.
 *
 * Both routes answer 200 with the Sanaad envelope rather than 201/204, so the
 * app parses one response shape across the API.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post('device-token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Register this device for push notifications',
    operationId: 'notifications_registerDevice',
  })
  @ApiOkResponse({
    schema: { example: { status: 'success', message: 'Device registered for notifications.' } },
  })
  async register(@Body() dto: RegisterDeviceTokenDto, @CurrentUser() user: AuthenticatedUser) {
    await this.service.register({
      username: user.username,
      imei: dto.imei,
      token: dto.token,
      platform: dto.platform,
      appVersion: dto.appVersion,
    });
    return { message: 'Device registered for notifications.' };
  }

  /**
   * Call this on logout. A token left registered keeps delivering the previous
   * user's notifications to a handset they no longer hold.
   *
   * A POST, because the WAF in front of the API blocks the DELETE method
   * outright — measured against staging: with a body, with none, with the IMEI
   * in the path and in the query string, every shape came back as the WAF's
   * rejection page. It answers **HTTP 200** while doing so, so the DELETE
   * below looked like it was working from the client's side while the request
   * never reached the API at all and the row survived.
   *
   * This is the route the app must call.
   */
  @Post('device-token/unregister')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stop sending push notifications to this device',
    operationId: 'notifications_unregisterDevice',
  })
  @ApiOkResponse({
    schema: { example: { status: 'success', message: 'Device unregistered.' } },
  })
  async unregister(
    @Body() dto: UnregisterDeviceTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.unregister(user.username, dto.imei);
    return { message: 'Device unregistered.' };
  }

  /**
   * Send a real notification to the caller's own devices and report FCM's
   * verdict per device.
   *
   * Everything in this module degrades silently: with no credential the sender
   * is a no-op and registration still answers 200, so "can this deployment
   * actually deliver?" had no answer from outside short of reading the boot
   * log or waiting for a dead token to vanish from the table. Three separate
   * attempts to establish it ended in inference.
   *
   * Only ever to the caller's OWN devices — the user comes from the token, so
   * this cannot be pointed at anyone else. Behind DIAGNOSTICS_ENABLED like the
   * rest of the test surface.
   */
  @UseGuards(DiagnosticsEnabledGuard)
  @Post('device-token/test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a test notification to your own devices and report the result',
    operationId: 'notifications_testPush',
  })
  @ApiOkResponse({
    schema: {
      example: {
        devices: 2,
        sent: 2,
        failed: 0,
        invalidTokens: [],
        pushConfigured: true,
      },
    },
  })
  async test(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.service.sendTest(user.username, {
      title: 'Sanaad',
      body: 'Test notification from the server.',
      data: { type: 'test', sentAt: new Date().toISOString() },
    });
    return {
      ...result,
      // sent=0 across live devices is what an unconfigured credential looks
      // like, and it is indistinguishable from "no devices" without this.
      pushConfigured: result.devices > 0 && result.sent + result.failed > 0,
    };
  }

  /**
   * The original spelling, kept for anything already calling it from inside
   * the network, where there is no WAF in the way. Unreachable for the mobile
   * app — see the POST above.
   */
  @Delete('device-token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unregister a device (DELETE — blocked by the WAF, use the POST)',
    operationId: 'notifications_unregisterDeviceLegacy',
  })
  async unregisterViaDelete(
    @Body() dto: UnregisterDeviceTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.unregister(user.username, dto.imei);
    return { message: 'Device unregistered.' };
  }
}
