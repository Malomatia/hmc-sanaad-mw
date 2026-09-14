import { Injectable, Logger } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { str } from '@shared/utils/mapper.util';
import {
  RequestLookupPort,
  RequestParticipants,
} from '../../domain/ports/request-lookup.port';

type Row = Record<string, unknown>;

/**
 * Resolves the people involved in a request, for addressing a notification.
 *
 * Two things make this more than a single SELECT:
 *
 *  - the summary views store a person as their EMPLOYEE NUMBER, while device
 *    tokens are keyed by LOGIN, so every name is translated before use;
 *  - a submit gives back no identifier at all, so "what did this person just
 *    submit" is answered by the newest row in their own requests view.
 *
 * Nothing here throws. A notification is an accessory to an action that has
 * already succeeded, so a failed lookup means nobody is notified — never a
 * failed request.
 */
@Injectable()
export class OracleRequestLookupRepository
  extends BaseOracleRepository
  implements RequestLookupPort
{
  private static readonly log = new Logger(OracleRequestLookupRepository.name);
  /** employee number → login, resolved once per process. */
  private static readonly logins = new Map<string, string | undefined>();

  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async findLatestSubmission(username: string): Promise<RequestParticipants | undefined> {
    return this.safely('findLatestSubmission', async () => {
      const employeeNumber = await this.employeeNumberOf(username);
      const keys = [username, employeeNumber].filter(Boolean) as string[];
      if (!keys.length) return undefined;

      const rows = await this.query<Row>(
        `SELECT * FROM (
           SELECT v.* FROM ${ORACLE_OBJECTS.MY_REQEST_SUMMARY_V} v
            WHERE UPPER(requestor_user_name) IN (${keys.map((_, i) => `:k${i}`).join(', ')})
            ORDER BY date_of_submission DESC
         ) WHERE ROWNUM = 1`,
        Object.fromEntries(keys.map((k, i) => [`k${i}`, k.toUpperCase()])),
      );
      return rows[0] ? this.toParticipants(rows[0]) : undefined;
    });
  }

  async findByNotificationId(notificationId: string): Promise<RequestParticipants | undefined> {
    return this.safely('findByNotificationId', async () => {
      for (const object of [
        ORACLE_OBJECTS.MY_REQEST_SUMMARY_V,
        ORACLE_OBJECTS.APPROVE_SUMRY_V,
        ORACLE_OBJECTS.NOTYFY_APPR_V,
      ]) {
        const rows = await this.query<Row>(
          `SELECT * FROM ${object} WHERE notification_id = :id`,
          { id: notificationId },
        );
        if (rows[0]) return this.toParticipants(rows[0]);
      }
      return undefined;
    });
  }

  /** Translate both parties to the login form the token store is keyed by. */
  private async toParticipants(row: Row): Promise<RequestParticipants> {
    const [requestor, approver] = await Promise.all([
      this.loginOf(str(row, 'REQUESTOR_USER_NAME')),
      this.loginOf(str(row, 'APPROVER_USER_NAME')),
    ]);
    return {
      requestor,
      approver,
      requestType: str(row, 'REQUEST_TYPE') ?? str(row, 'SERVICE_REQUEST'),
      notificationId: str(row, 'NOTIFICATION_ID'),
    };
  }

  /**
   * A value from these views is an employee number in most rows and a login in
   * others, so anything non-numeric is already a login and anything numeric is
   * translated.
   */
  private async loginOf(value?: string): Promise<string | undefined> {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    if (!/^\d+$/.test(trimmed)) return trimmed;

    const cache = OracleRequestLookupRepository.logins;
    if (!cache.has(trimmed)) {
      const rows = await this.query<Row>(
        `SELECT user_name FROM ${ORACLE_OBJECTS.PERSONAL_DETAILS_V}
          WHERE employee_number = :n AND ROWNUM = 1`,
        { n: trimmed },
      ).catch(() => []);
      cache.set(trimmed, str(rows[0] ?? {}, 'USER_NAME'));
    }
    return cache.get(trimmed) ?? trimmed;
  }

  private async employeeNumberOf(username: string): Promise<string | undefined> {
    const rows = await this.query<Row>(
      `SELECT employee_number FROM ${ORACLE_OBJECTS.PERSONAL_DETAILS_V}
        WHERE UPPER(user_name) = :u AND ROWNUM = 1`,
      { u: username.toUpperCase() },
    ).catch(() => []);
    return str(rows[0] ?? {}, 'EMPLOYEE_NUMBER');
  }

  private async safely<T>(operation: string, work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (err) {
      OracleRequestLookupRepository.log.warn(
        `Notification lookup (${operation}) failed: ${(err as Error).message}`,
      );
      return undefined;
    }
  }
}
