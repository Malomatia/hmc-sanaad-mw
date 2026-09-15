import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DemoService } from '../application/demo.service';
import { DemoRequestDto } from './dto/demo.request.dto';
import { Public } from '../../../core/auth/decorators/public.decorator';

@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}
    
  @Public()
  @Get('info')
  @ApiOperation({
    summary: 'Get dummy employee information',
    operationId: 'demo_getInfo',
  })
  @ApiOkResponse({
    description: 'Dummy employee information',
  })
  getInfo() {
    return this.demo.getInfo();
  }

  @Public()
  @Post('info')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Submit dummy employee information',
    operationId: 'demo_createInfo',
  })
  @ApiBody({
    type: DemoRequestDto,
  })
  @ApiOkResponse({
    description: 'Dummy employee information received',
  })
  createInfo(@Body() dto: DemoRequestDto) {
    return this.demo.createInfo(dto);
  }
}