import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { DevConsoleConfig } from '../config/configuration';

/**
 * Gate for the internal developer console. Needs no configuration to work:
 *  1. `DEV_CONSOLE_ENABLED` defaults to true — set it to `false` to make the
 *     routes disappear (404, so probing cannot tell the feature exists).
 *  2. `DEV_CONSOLE_TOKEN`, when set, must match the `x-console-token` header
 *     or `?token=` query parameter → 403 otherwise.
 *
 * The console itself starts read-only (see DevConsoleService): SELECT / WITH /
 * EXPLAIN are executed and rolled back; anything that writes requires the
 * explicit write switch in the UI, which lives in memory only.
 */
@Injectable()
export class DevConsoleGuard implements CanActivate {
  private readonly cfg: DevConsoleConfig;

  constructor(config: ConfigService) {
    this.cfg = { ...config.get<DevConsoleConfig>('devConsole', {
      enabled: false,
      token: '',
      allowWrite: false,
      maxRows: 500,
      timeoutMs: 60000,
    }) };
    if (config.get<string>('app.nodeEnv') === 'production') this.cfg.enabled = false;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!this.cfg.enabled) {
      // Same response as an unknown route: presence of the console is not leaked.
      throw new NotFoundException(`Cannot ${req.method} ${req.path}`);
    }
    const supplied = req.headers['x-console-token'];
    const expected = Buffer.from(this.cfg.token);
    const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
    if (expected.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ForbiddenException('Invalid console token.');
    }
    return true;
  }
}
