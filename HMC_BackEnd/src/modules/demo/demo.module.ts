import { Module } from '@nestjs/common';

import { DemoController } from './interface/demo.controller';
import { DemoService } from './application/demo.service';
import { DEMO_REPOSITORY } from './domain/demo.repository';
import { DemoDummyRepository } from './infrastructure/dummy/demo.dummy.repository';

@Module({
  controllers: [DemoController],
  providers: [
    DemoService,
    {
      provide: DEMO_REPOSITORY,
      useClass: DemoDummyRepository,
    },
  ],
})
export class DemoModule {}