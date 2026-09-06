import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuthConfig } from '@core/config/configuration';
import { AuthenticatedUser, Role } from '@core/auth/auth-user.interface';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { AuditService } from '@core/audit/audit.service';
import { AuthLifecycleEvent } from '@core/audit/audit-event';
import { MPIN_STORE_PORT, MpinStorePort } from '../domain/ports/mpin-store.port';
import { LDAP_USER_PORT, LdapUserPort } from '../domain/ports/ldap-user.port';
import { FUNCTION_ACCESS_PORT, FunctionAccessPort } from '../domain/ports/function-access.port';
import { DEVICE_REGISTRY_PORT, DeviceRegistryPort } from '../domain/ports/device-registry.port';
import { EmployeeIdentity, FunctionAccess, FunctionStatus } from '../domain/auth-identity';
import {
  LoginRequestDto,
  LoginResponseDto,
  LogoutRequestDto,
  MeResponseDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
  StatusMessageDto,
} from '../interface/dto/auth.dto';
import { DEV_FUNCTION_ACCESS, devIdentity } from './dev-fallback';
import { STATIC_FUNCTION_ACCESS, STATIC_LOGIN_IDENTITY } from './static-login.data';

/**
 * API-5 Login + current-identity. Verifies the MPIN (MpinStorePort), resolves the
 * employee (LdapUserPort), builds the function-access list (FunctionAccessPort),
 * and issues a JWT carrying roles + enabled function codes. When
 * AUTH_DISABLED=true an explicit dev bypass skips MPIN verification and returns
 * a static identity/function list; with AUTH_DISABLED=false the real journey
 * runs in every environment (MPIN → directory → function access).
 *
 * AUTH_STATIC_LOGIN=true (testing only, takes precedence): login returns the
 * fixed AIBRAHIM39 payload (static-login.data.ts) and the FULL user data —
 * employee fields + functionaccesslist — is embedded in the signed JWT as a
 * `userdata` claim so the client can read everything from the token alone.
 * Note the JWT is signed (tamper-proof), not encrypted: its payload is
 * base64-readable by design.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly devBypass: boolean;
  private readonly staticLogin: boolean;
  private readonly expiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private readonly jwt: JwtService,
    @Inject(MPIN_STORE_PORT) private readonly mpinStore: MpinStorePort,
    @Inject(LDAP_USER_PORT) private readonly ldap: LdapUserPort,
    @Inject(FUNCTION_ACCESS_PORT) private readonly functionAccess: FunctionAccessPort,
    @Inject(DEVICE_REGISTRY_PORT) private readonly devices: DeviceRegistryPort,
    private readonly audit: AuditService,
    private readonly revocation: TokenRevocationService,
    config: ConfigService,
  ) {
    this.devBypass = config.get<boolean>('auth.disabled', false);
    const auth = config.getOrThrow<AuthConfig>('auth');
    this.staticLogin = auth.staticLogin;
    this.expiresIn = auth.jwtExpiresIn;
    this.refreshExpiresIn = auth.jwtRefreshExpiresIn;
  }

  async login(dto: LoginRequestDto): Promise<LoginResponseDto> {
    const ctx = {
      username: dto.username,
      deviceImei: dto.imeinumber,
      platform: dto.platform,
      appVersion: dto.version,
    };

    let identity: EmployeeIdentity;
    let functionList: FunctionAccess[];

    if (this.staticLogin) {
      this.logger.warn(
        `AUTH_STATIC_LOGIN: static login payload for "${dto.username}" (no MPIN/directory/DB).`,
      );
      identity = STATIC_LOGIN_IDENTITY;
      functionList = STATIC_FUNCTION_ACCESS;
    } else if (this.devBypass) {
      this.logger.warn(`DEV bypass: login for "${dto.username}" WITHOUT MPIN verification.`);
      identity = devIdentity(dto.username);
      functionList = DEV_FUNCTION_ACCESS;
    } else {
      const ok = await this.mpinStore.verify({
        username: dto.username,
        imei: dto.imeinumber,
        mpin: dto.mpin,
      });
      if (!ok) {
        this.audit.lifecycle(AuthLifecycleEvent.LOGIN_FAILURE, { ...ctx, status: 'error' });
        return { status: 'error', message: 'Invalid credentials.' };
      }
      identity = await this.ldap.validate({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      functionList = await this.functionAccess.list(identity.employeeNumber ?? dto.username);

      // Stamp the device registration's LastActive. A side effect of an
      // already-successful login: best-effort, never fails the request.
      this.devices.touch(dto.username, dto.imeinumber).catch((err: Error) => {
        this.logger.warn(`Could not update LastActive for "${dto.username}": ${err.message}`);
      });
    }

    const roles = (identity.roles as Role[] | undefined) ?? [Role.EMPLOYEE];
    const enabledFunctions = functionList
      .filter((f) => f.status === FunctionStatus.ENABLED)
      .map((f) => f.functioncode);

    const baseClaims: Record<string, unknown> = {
      sub: identity.employeeNumber ?? dto.username,
      username: identity.username,
      employeeNumber: identity.employeeNumber,
      roles,
      functions: enabledFunctions,
      name: identity.employeeName,
      dept: identity.department,
      company: identity.company,
      // Static-login testing: the FULL user data travels inside the token so
      // the client can decode everything from the JWT alone.
      ...(this.staticLogin && {
        userdata: {
          employeeusername: identity.username,
          employeenumber: identity.employeeNumber,
          employeename: identity.employeeName,
          employeenamear: identity.employeeNameAr,
          employeedepartment: identity.department,
          employeecompany: identity.company,
          functionaccesslist: functionList,
        },
      }),
    };
    const { token, refreshtoken } = await this.issueTokenPair(baseClaims);

    this.audit.lifecycle(AuthLifecycleEvent.LOGIN_SUCCESS, { ...ctx, status: 'success' });

    return {
      status: 'success',
      token,
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      refreshtoken,
      employeeusername: identity.username,
      employeenumber: identity.employeeNumber,
      employeename: identity.employeeName,
      employeenamear: identity.employeeNameAr,
      employeedepartment: identity.department,
      employeecompany: identity.company,
      functionaccesslist: functionList,
    };
  }

  /**
   * Refresh: exchange a valid refresh token (typ=refresh, not revoked) for a
   * new access + refresh pair. The used refresh token is revoked (one-time
   * use / rotation). Follows the Sanaad convention of HTTP 200 with
   * status=error on failure (like login's invalid-credentials response).
   */
  async refresh(dto: RefreshTokenRequestDto): Promise<RefreshTokenResponseDto> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(dto.refreshtoken);
    } catch {
      return { status: 'error', message: 'Invalid or expired refresh token.' };
    }
    if (payload.typ !== 'refresh') {
      return { status: 'error', message: 'Not a refresh token.' };
    }
    const jti = payload.jti as string | undefined;
    if (jti && this.revocation.isRevoked(jti)) {
      this.logger.warn(`Refresh token ${jti} reused after rotation/logout — rejected.`);
      return { status: 'error', message: 'This refresh token has been revoked.' };
    }

    // Rotate: the used refresh token dies with this exchange.
    if (jti) this.revocation.revoke(jti, payload.exp as number | undefined);

    // Re-mint from the refresh token's own identity claims (registered claims stripped).
    const { exp, iat, nbf, jti: _jti, typ, ...baseClaims } = payload;
    void exp; void iat; void nbf; void _jti; void typ;
    const { token, refreshtoken } = await this.issueTokenPair(baseClaims);
    this.logger.log(`Token refreshed for "${String(baseClaims.username ?? baseClaims.sub)}".`);
    return { status: 'success', token, tokenType: 'Bearer', expiresIn: this.expiresIn, refreshtoken };
  }

  /**
   * Logout: revoke the presented access token (jti denylist checked by
   * JwtStrategy) and, when the client also sends its refresh token, revoke
   * that too so the pair is fully dead. JWTs being stateless, the client must
   * still discard both tokens locally.
   */
  async logout(user: AuthenticatedUser, dto: LogoutRequestDto): Promise<StatusMessageDto> {
    const claims = (user.claims ?? {}) as { jti?: string; exp?: number };
    if (claims.jti) this.revocation.revoke(claims.jti, claims.exp);

    if (dto.refreshtoken) {
      try {
        const payload = await this.jwt.verifyAsync<{ jti?: string; exp?: number }>(dto.refreshtoken);
        if (payload.jti) this.revocation.revoke(payload.jti, payload.exp);
      } catch {
        // An invalid/expired refresh token needs no revocation.
      }
    }

    this.audit.lifecycle(AuthLifecycleEvent.LOGOUT, { username: user.username, status: 'success' });
    return { status: 'success', message: 'Logged out successfully.' };
  }

  /** Sign an access + refresh token pair from shared identity claims. */
  private async issueTokenPair(
    baseClaims: Record<string, unknown>,
  ): Promise<{ token: string; refreshtoken: string }> {
    const token = await this.jwt.signAsync({ ...baseClaims, jti: randomUUID() });
    const refreshtoken = await this.jwt.signAsync(
      { ...baseClaims, typ: 'refresh', jti: randomUUID() },
      { expiresIn: this.refreshExpiresIn as JwtSignOptions['expiresIn'] },
    );
    return { token, refreshtoken };
  }

  me(user: AuthenticatedUser): MeResponseDto {
    return {
      username: user.username,
      employeeNumber: user.employeeNumber,
      roles: user.roles,
      functions: user.functions,
    };
  }
}
