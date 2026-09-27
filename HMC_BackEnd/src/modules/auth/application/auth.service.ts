import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AuthStateService } from '@core/auth/auth-state.service';
import { assertSessionClaims, SessionClaims } from '@core/auth/jwt-claims';
import { AuthConfig } from '@core/config/configuration';
import { AuthenticatedUser, Role } from '@core/auth/auth-user.interface';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { AuditService } from '@core/audit/audit.service';
import { AuthLifecycleEvent } from '@core/audit/audit-event';
import { DEFAULT_LANG, Lang } from '@shared/domain/lang';
import { MPIN_STORE_PORT, MpinStorePort } from '../domain/ports/mpin-store.port';
import { LDAP_USER_PORT, LdapUserPort } from '../domain/ports/ldap-user.port';
import { FUNCTION_ACCESS_PORT, FunctionAccessPort } from '../domain/ports/function-access.port';
import { DEVICE_REGISTRY_PORT, DeviceRegistryPort } from '../domain/ports/device-registry.port';
import {
  LOGIN_EMPLOYMENT_PORT,
  LoginEmploymentDetails,
  LoginEmploymentPort,
} from '../domain/ports/login-employment.port';
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
import {
  ORACLE_USER_VALIDATION_PORT,
  OracleUserValidationPort,
} from '../domain/ports/oracle-user-validation.port';

const NON_ORACLE_FUNCTION_CODES = new Set([
  'frmHousing',
  'frmStaffclinic',
  'frmSogha',
  'flxbanner',
]);

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
  private readonly authConfig: AuthConfig;

  constructor(
    private readonly jwt: JwtService,
    @Inject(MPIN_STORE_PORT) private readonly mpinStore: MpinStorePort,
    @Inject(LDAP_USER_PORT) private readonly ldap: LdapUserPort,
    @Inject(FUNCTION_ACCESS_PORT) private readonly functionAccess: FunctionAccessPort,
    @Inject(DEVICE_REGISTRY_PORT) private readonly devices: DeviceRegistryPort,
    @Inject(LOGIN_EMPLOYMENT_PORT) private readonly employment: LoginEmploymentPort,
    @Inject(ORACLE_USER_VALIDATION_PORT) private readonly oracleUser: OracleUserValidationPort,
    private readonly audit: AuditService,
    private readonly revocation: TokenRevocationService,
    private readonly config: ConfigService,
    private readonly state: AuthStateService,
  ) {
    this.devBypass = config.get<boolean>('auth.disabled', false);
    const auth = config.getOrThrow<AuthConfig>('auth');
    this.authConfig = auth;
    this.staticLogin = auth.staticLogin;
    this.expiresIn = auth.jwtExpiresIn;
    this.refreshExpiresIn = auth.jwtRefreshExpiresIn;
  }

  async login(dto: LoginRequestDto, lang: Lang = DEFAULT_LANG): Promise<LoginResponseDto> {
    const ctx = {
      username: dto.username,
      deviceImei: dto.imeinumber,
      platform: dto.platform,
      appVersion: dto.version,
    };

    let identity: EmployeeIdentity;
    let functionList: FunctionAccess[];
    let isOrcaleUser = true;
    let employment: LoginEmploymentDetails = {};

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
      await this.state.limit(
        'mpin-login',
        dto.username.trim().toUpperCase(),
        this.config.get<number>('mpin.maxAttempts', 5),
        this.config.get<number>('mpin.lockoutMinutes', 15) * 60,
      );
      const ok = await this.mpinStore.verify({
        username: dto.username,
        imei: dto.imeinumber,
        mpin: dto.mpin,
      });
      if (!ok) {
        this.audit.lifecycle(AuthLifecycleEvent.LOGIN_FAILURE, { ...ctx, status: 'error' });
        return {
          status: 'error',
          message: lang === 'ar' ? 'البيانات المدخله غير صحيحه.' : 'Invalid credentials.',
        };
      }
      identity = await this.ldap.validate({
        username: dto.username,
        imei: dto.imeinumber,
        platform: dto.platform,
      });
      if (!identity.isEmployee) {
        this.audit.lifecycle(AuthLifecycleEvent.LOGIN_FAILURE, { ...ctx, status: 'error' });
        return {
          status: 'error',
          message: lang === 'ar' ? 'البيانات المدخله غير صحيحه.' : 'Invalid credentials.',
        };
      }
      [functionList, isOrcaleUser, employment] = await Promise.all([
        this.functionAccess.list(identity.employeeNumber ?? dto.username),
        this.oracleUser.validate(dto.username),
        this.employment.resolve(identity),
      ]);

      // Stamp the device registration's LastActive. A side effect of an
      // already-successful login: best-effort, never fails the request.
      this.devices.touch(dto.username, dto.imeinumber).catch((err: Error) => {
        this.logger.warn(`Could not update LastActive for "${dto.username}": ${err.message}`);
      });
    }

    if (!isOrcaleUser) {
      functionList = functionList.filter((f) => NON_ORACLE_FUNCTION_CODES.has(f.functioncode));
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
      deviceImei: dto.imeinumber,
      appName: dto.appname,
      appVersion: dto.version,
      platform: dto.platform,
      // Static-login testing: the FULL user data travels inside the token so
      // the client can decode everything from the JWT alone.
      ...(this.staticLogin && {
        userdata: {
          employeeusername: identity.username.toUpperCase(),
          employeenumber: identity.employeeNumber,
          employeename: identity.employeeName,
          employeenamear: identity.employeeNameAr,
          employeedepartment: identity.department,
          employeecompany: identity.company,
          isOrcaleUser,
          functionaccesslist: functionList,
        },
      }),
    };
    const { token, refreshtoken } = await this.issueTokenPair(baseClaims, undefined, dto.mpin);

    this.audit.lifecycle(AuthLifecycleEvent.LOGIN_SUCCESS, { ...ctx, status: 'success' });

    return {
      status: 'success',
      token,
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      refreshtoken,
      employeeusername: identity.username.toUpperCase(),
      employeenumber: identity.employeeNumber,
      employeename: identity.employeeName,
      employeenamear: identity.employeeNameAr,
      job_title: employment.jobTitle,
      job_title_ar: employment.jobTitleAr,
      organization_name: employment.organizationName,
      organization_name_ar: employment.organizationNameAr,
      employeedepartment: identity.department,
      employeecompany: identity.company,
      isOrcaleUser,
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
    let payload: SessionClaims;
    try {
      const verified = await this.jwt.verifyAsync<Record<string, unknown>>(dto.refreshtoken, {
        algorithms: ['HS256'],
        issuer: this.authConfig.jwtIssuer,
        audience: this.authConfig.jwtAudience,
      });
      if (verified.typ !== 'refresh') return { status: 'error', message: 'Not a refresh token.' };
      assertSessionClaims(verified, 'refresh');
      payload = verified;
    } catch {
      return { status: 'error', message: 'Invalid or expired refresh token.' };
    }
    const { jti } = payload;
    if ((this.devBypass || this.staticLogin) && this.revocation.isRevoked(jti)) {
      this.logger.warn(`Refresh token ${jti} reused after rotation/logout — rejected.`);
      return { status: 'error', message: 'This refresh token has been revoked.' };
    }

    // Rotate: the used refresh token dies with this exchange.
    if (this.devBypass || this.staticLogin) this.revocation.revoke(jti, payload.exp);

    // Re-mint from the refresh token's own identity claims (registered claims stripped).
    const { exp, iat, nbf, jti: _jti, typ, iss, aud, ...baseClaims } = payload;
    void exp;
    void iat;
    void nbf;
    void _jti;
    void typ;
    void iss;
    void aud;
    if (!this.devBypass && !this.staticLogin) {
      if (!(await this.state.sessionActive(payload.sid, payload.username, payload.deviceImei))) {
        return {
          status: 'error',
          message: 'This session is no longer valid. Please log in again.',
        };
      }
      const identity = await this.ldap.validate({
        username: payload.username,
        imei: payload.deviceImei,
      });
      if (!identity.isEmployee) {
        await this.state.revokeSession(payload.sid, payload.username, payload.deviceImei);
        return {
          status: 'error',
          message: 'This session is no longer valid. Please log in again.',
        };
      }
      const [functions, oracleUser] = await Promise.all([
        this.functionAccess.list(identity.employeeNumber ?? identity.username),
        this.oracleUser.validate(identity.username),
      ]);
      baseClaims.functions = functions
        .filter(
          (f) =>
            f.status === FunctionStatus.ENABLED &&
            (oracleUser || NON_ORACLE_FUNCTION_CODES.has(f.functioncode)),
        )
        .map((f) => f.functioncode);
      baseClaims.roles = (identity.roles as Role[] | undefined) ?? [Role.EMPLOYEE];
    }
    try {
      const { token, refreshtoken } = await this.issueTokenPair(baseClaims, jti);
      this.logger.log(`Token refreshed for "${String(baseClaims.username ?? baseClaims.sub)}".`);
      return {
        status: 'success',
        token,
        tokenType: 'Bearer',
        expiresIn: this.expiresIn,
        refreshtoken,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        return {
          status: 'error',
          message: 'This session is no longer valid. Please log in again.',
        };
      }
      throw err;
    }
  }

  /**
   * Logout: revoke the presented access token (jti denylist checked by
   * JwtStrategy) and, when the client also sends its refresh token, revoke
   * that too so the pair is fully dead. JWTs being stateless, the client must
   * still discard both tokens locally.
   */
  async logout(user: AuthenticatedUser, dto: LogoutRequestDto): Promise<StatusMessageDto> {
    const claims = (user.claims ?? {}) as {
      jti?: string;
      exp?: number;
      sid?: string;
      deviceImei?: string;
    };
    if (!this.devBypass && !this.staticLogin && claims.sid && claims.deviceImei) {
      await this.state.revokeSession(claims.sid, user.username, claims.deviceImei);
    }
    if (claims.jti) this.revocation.revoke(claims.jti, claims.exp);

    if (dto.refreshtoken) {
      try {
        const payload = await this.jwt.verifyAsync<{ jti?: string; exp?: number }>(
          dto.refreshtoken,
        );
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
    previousRefreshId?: string,
    mpin?: string,
  ): Promise<{ token: string; refreshtoken: string }> {
    const session = this.state.newSession(
      String(baseClaims.username),
      String(baseClaims.deviceImei),
      new Date(),
    );
    if (previousRefreshId) session.sid = String(baseClaims.sid);
    const options: JwtSignOptions = {
      algorithm: 'HS256',
      issuer: this.authConfig.jwtIssuer,
      audience: this.authConfig.jwtAudience,
    };
    const token = await this.jwt.signAsync(
      { ...baseClaims, sid: session.sid, typ: 'access', jti: session.accessId },
      options,
    );
    const refreshtoken = await this.jwt.signAsync(
      { ...baseClaims, sid: session.sid, typ: 'refresh', jti: session.refreshId },
      { ...options, expiresIn: this.refreshExpiresIn as JwtSignOptions['expiresIn'] },
    );
    session.expiresAt = new Date(this.jwt.decode<SessionClaims>(refreshtoken).exp * 1000);
    if (!this.devBypass && !this.staticLogin) {
      if (previousRefreshId) await this.state.rotateSession(session, previousRefreshId);
      else await this.state.createSession(session, mpin!);
    }
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
