import { Module } from '@nestjs/common';
import { ApiLogsController } from './api-logs.controller';
import { ApiLogsService } from './api-logs.service';
import { ApiLogStore } from './api-log.store';
import { ApiLogFileWriter } from './api-log-file-writer.service';

/**
 * API request/response monitoring module: the store/service/controller behind
 * `/api-logs`. `ApiLogStore` and `ApiLogFileWriter` are exported so CoreModule
 * can construct `ApiLogInterceptor` (registered there, in the exact provider
 * slot the old global `LoggingInterceptor` occupied, so ordering relative to
 * the other global interceptors is unchanged and explicit).
 */
@Module({
  controllers: [ApiLogsController],
  providers: [ApiLogsService, ApiLogStore, ApiLogFileWriter],
  exports: [ApiLogStore, ApiLogFileWriter],
})
export class ApiLogsModule {}
