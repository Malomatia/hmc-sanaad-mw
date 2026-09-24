import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/auth/decorators/public.decorator';
import { ProxyService } from '../proxy/proxy.service';

/** Public app settings (terms & conditions), forwarded to HMC_BackEnd. */
@ApiTags('auth')
@Controller('app-setting')
export class AppSettingController {
  constructor(private readonly proxy: ProxyService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'App settings (terms & conditions)', operationId: 'auth_appSetting' })
  get(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.proxy.forward(req, res);
  }
}
