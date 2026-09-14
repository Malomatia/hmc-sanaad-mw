import { Module } from '@nestjs/common';
import { DevConsoleController } from './dev-console.controller';
import { DevConsoleService } from './dev-console.service';
import { DevConsoleGuard } from './dev-console.guard';

/**
 * Internal developer console (SQL worksheet + API tester). Registered
 * unconditionally so configuration stays in one place — DevConsoleGuard is
 * what actually opens or 404s the routes (see DevConsoleController).
 * Depends only on the global OracleModule (OracleService + OracleLogStore).
 */
@Module({
  controllers: [DevConsoleController],
  providers: [DevConsoleService, DevConsoleGuard],
})
export class DevConsoleModule {}
