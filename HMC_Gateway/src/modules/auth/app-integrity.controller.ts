import { Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '@core/auth/decorators/public.decorator';
import { ProxyService } from '../proxy/proxy.service';

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
}
