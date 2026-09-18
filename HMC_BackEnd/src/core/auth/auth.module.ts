import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthConfig } from '../config/configuration';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TokenRevocationService } from './token-revocation.service';
import { AuthStateService } from './auth-state.service';

/**
 * Global auth building blocks: JWT verification, JwtAuthGuard, RolesGuard.
 * JwtModule is exported so the (pending) AuthService can sign tokens once the
 * op-1 login spec is available.
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AuthConfig>('auth');
        return {
          secret: auth.jwtSecret,
          signOptions: { expiresIn: auth.jwtExpiresIn as JwtSignOptions['expiresIn'],
            algorithm: 'HS256', issuer: auth.jwtIssuer, audience: auth.jwtAudience },
          verifyOptions: { algorithms: ['HS256'], issuer: auth.jwtIssuer, audience: auth.jwtAudience },
        };
      },
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, RolesGuard, TokenRevocationService, AuthStateService],
  exports: [JwtModule, PassportModule, JwtAuthGuard, RolesGuard, TokenRevocationService, AuthStateService],
})
export class AuthModule {}
