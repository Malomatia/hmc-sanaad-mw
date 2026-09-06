import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { OracleModule } from './database/oracle.module';
import { MssqlModule } from './database/mssql.module';
import { EmailModule } from './email/email.module';
import { FirebaseModule } from './firebase/firebase.module';

import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AllExceptionsFilter } from './http/all-exceptions.filter';
import { ResponseInterceptor } from './http/response.interceptor';
import { TimeoutInterceptor } from './http/timeout.interceptor';
import { CorrelationIdMiddleware } from './http/correlation-id.middleware';
import { HealthController } from './health/health.controller';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { FunctionAccessGuard } from './auth/function-access.guard';
import { ApiLogsModule } from './logging/api-logs.module';
import { ApiLogInterceptor } from './logging/api-log.interceptor';
import { DevConsoleModule } from './dev-console/dev-console.module';

/**
 * Framework-level cross-cutting concerns wired once for the whole app:
 * validated config, Oracle pool, auth, global pipe/guards/interceptors/filters,
 * and the correlation-id middleware.
 *
 * A single global filter (AllExceptionsFilter) categorizes every exception —
 * including OracleQueryError — into a safe, consistent error envelope.
 *
 * ApiLogInterceptor is the OUTERMOST interceptor (first APP_INTERCEPTOR), so it
 * observes the final response (success) or the original exception (failure)
 * for every request and logs it automatically — see `logging/` module.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    EventEmitterModule.forRoot(),
    OracleModule,
    MssqlModule,
    EmailModule,
    FirebaseModule,
    AuthModule,
    AuditModule,
    ApiLogsModule,
    DevConsoleModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_INTERCEPTOR, useClass: ApiLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: FunctionAccessGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
