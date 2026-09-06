import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration, { ThrottleConfig } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { HttpClientModule } from './http/http-client.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { IntegrityPreCheckGuard } from './integrity/integrity-precheck.guard';
import { AllExceptionsFilter } from './http/all-exceptions.filter';
import { CorrelationIdMiddleware } from './http/correlation-id.middleware';
import { HealthController } from './health/health.controller';

/**
 * Framework-level cross-cutting concerns wired once for the whole gateway:
 * validated config, shared HTTP client to the backend, JWT auth guard
 * (global, skips @Public() routes), throttling, a single exception filter,
 * and the correlation-id middleware.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const throttle = config.getOrThrow<ThrottleConfig>('throttle');
        return {
          throttlers: [{ limit: throttle.loginLimit, ttl: throttle.loginTtlMs }],
        };
      },
    }),
    HttpClientModule,
    AuthModule,
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After the JWT: identity first, then whether the caller looks like our app.
    { provide: APP_GUARD, useClass: IntegrityPreCheckGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
