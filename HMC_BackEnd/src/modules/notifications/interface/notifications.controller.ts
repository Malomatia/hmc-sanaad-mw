import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
