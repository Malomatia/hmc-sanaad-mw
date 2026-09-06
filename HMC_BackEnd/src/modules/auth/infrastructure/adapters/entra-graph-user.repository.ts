import {
  Injectable,
  Logger,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { Role } from '@core/auth/auth-user.interface';
import { EntraConfig } from '@core/config/configuration';
import {
  AuthenticateUserQuery,
  LdapUserPort,
  ValidateUserQuery,
} from '../../domain/ports/ldap-user.port';
import { EmployeeIdentity } from '../../domain/auth-identity';

/** Graph user properties requested for the identity mapping. */
const USER_SELECT = [
  'userPrincipalName',
  'displayName',
  'givenName',
  'surname',
  'mail',
  'mobilePhone',
  'businessPhones',
  'department',
  'companyName',
  'employeeId',
].join(',');

/** Minimal shape of the Graph user object we consume. */
interface GraphUser {
  userPrincipalName?: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  mail?: string;
  mobilePhone?: string;
  businessPhones?: string[];
  department?: string;
  companyName?: string;
  employeeId?: string;
}

/**
 * Azure Entra ID directory adapter — the cloud replacement for the LDAPS
 * `validate()` path (Microsoft Graph over HTTPS, app-only / client-credentials).
 *
 *  - `validate`     → acquire an app-only token (cached), resolve the user by
 *                     `GET /users/{username}` (falling back to an OData
 *                     `$filter` on the configured lookup attribute), and map
 *                     Graph attributes to EmployeeIdentity. No password.
 *  - `authenticate` → not used by the Sanaad journey (OTP + MPIN are the
 *                     credential); throws 501, mirroring the LDAP stub.
 *
 * The mobile-facing journey, DTOs, OTP/MPIN and JWT are unchanged — only the
 * directory lookup moves from LDAPS to Graph. Selected via AUTH_DIRECTORY=entra.
 */
@Injectable()
export class EntraGraphUserRepository implements LdapUserPort {
  private readonly logger = new Logger(EntraGraphUserRepository.name);
  private readonly cfg: EntraConfig;
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<EntraConfig>('entra');
  }

  async validate(query: ValidateUserQuery): Promise<EmployeeIdentity> {
    this.ensureConfigured();
    const token = await this.getAppToken();
    const user = await this.lookupUser(query.username, token);
    return this.toIdentity(query.username, user);
  }

  /**
   * Password verification is not part of the Entra ID flow: the journey
   * authenticates via OTP + MPIN, and Graph app-only lookup carries no
   * user password. Kept for port parity (mirrors the LDAP stub's 501).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  authenticate(_query: AuthenticateUserQuery): Promise<EmployeeIdentity> {
    throw new NotImplementedException(
      'Password authentication is not used with the Entra ID directory (journey uses OTP + MPIN).',
    );
  }

  private ensureConfigured(): void {
    if (!this.cfg.tenantId || !this.cfg.clientId || !this.cfg.clientSecret) {
      throw new ServiceUnavailableException(
        'Entra ID is not configured — set ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET.',
      );
    }
  }

  /**
   * Client-credentials (app-only) token, cached in-memory until ~60s before it
   * expires so we don't hit the token endpoint on every directory lookup.
   */
  private async getAppToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    const url = `${this.trimSlash(this.cfg.loginBaseUrl)}/${this.cfg.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });
    try {
      const res = await firstValueFrom(
        this.http.post<{ access_token: string; expires_in: number }>(url, body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: this.cfg.timeoutMs,
        }),
      );
      const expiresInMs = (res.data.expires_in ?? 3600) * 1000;
      this.token = {
        value: res.data.access_token,
        expiresAt: Date.now() + Math.max(expiresInMs - 60_000, 0),
      };
      return this.token.value;
    } catch (err) {
      throw this.wrap('token acquisition', err);
    }
  }

  /**
   * Resolve the user: first by direct key (`GET /users/{username}`), then — if
   * not found (404) — by an OData `$filter` on the configured lookup attribute.
   * A genuine "not found" returns `undefined` (mapped to isEmployee:false), not
   * an error, so the service returns the same "Invalid employee id" as today.
   */
  private async lookupUser(username: string, token: string): Promise<GraphUser | undefined> {
    const base = this.trimSlash(this.cfg.graphBaseUrl);
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const res = await firstValueFrom(
        this.http.get<GraphUser>(`${base}/users/${encodeURIComponent(username)}`, {
          params: { $select: USER_SELECT },
          headers,
          timeout: this.cfg.timeoutMs,
        }),
      );
      return res.data;
    } catch (err) {
      if (!this.isNotFound(err)) {
        throw this.wrap('user lookup', err);
      }
    }

    // Fallback: filter by the configured attribute (e.g. mail, employeeId).
    try {
      const filter = `${this.cfg.lookupAttribute} eq '${this.escapeOData(username)}'`;
      const res = await firstValueFrom(
        this.http.get<{ value?: GraphUser[] }>(`${base}/users`, {
          params: { $filter: filter, $select: USER_SELECT, $top: 1 },
          headers,
          timeout: this.cfg.timeoutMs,
        }),
      );
      return res.data.value?.[0];
    } catch (err) {
      throw this.wrap('user filter lookup', err);
    }
  }

  private toIdentity(username: string, user?: GraphUser): EmployeeIdentity {
    const employeeNumber = user?.employeeId || undefined;
    const fullName =
      user?.displayName || [user?.givenName, user?.surname].filter(Boolean).join(' ') || undefined;
    return {
      username: user?.userPrincipalName ?? username,
      employeeNumber,
      employeeName: fullName,
      department: user?.department || undefined,
      company: user?.companyName || undefined,
      phoneNumber: user?.mobilePhone || user?.businessPhones?.[0] || undefined,
      email: user?.mail || undefined,
      // Valid employee = resolved in Entra AND carries an employee id, matching
      // the LDAP adapter's rule (missing id => "Invalid employee id received.").
      isEmployee: user !== undefined && !!employeeNumber,
      // MPIN existence owns new-vs-existing, not the directory.
      isNewUser: false,
      roles: [Role.EMPLOYEE],
    };
  }

  private isNotFound(err: unknown): boolean {
    return err instanceof AxiosError && err.response?.status === 404;
  }

  /** OData string-literal escaping: single quotes are doubled. */
  private escapeOData(value: string): string {
    return value.replace(/'/g, "''");
  }

  private trimSlash(url: string): string {
    return url.replace(/\/+$/, '');
  }

  private wrap(stage: string, err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Entra ID ${stage} failed: ${message}`);
    return new ServiceUnavailableException(`Entra ID directory error: ${message}`);
  }
}
