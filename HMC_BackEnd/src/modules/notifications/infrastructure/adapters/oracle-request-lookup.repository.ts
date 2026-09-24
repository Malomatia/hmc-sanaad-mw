import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { str } from '@shared/utils/mapper.util';
import {
  RequestLookupPort,
  RequestParticipants,
  WorklistNotification,
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
  /** employee number → login, resolved once per process. */
  private static readonly logins = new Map<string, string>();

  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async findWorklistNotifications(username: string): Promise<WorklistNotification[] | undefined> {
    const login = username.trim().toUpperCase();
    if (!login) return [];

    return this.safely('findWorklistNotifications', async () => {
      const rows = await this.query<Row>(
        `SELECT NOTIFICATION_ID, FROM_ROLE, FROM_USER, RECIPIENT_ROLE, SUBJECT,
                BEGIN_DATE, ITEM_KEY, MESSAGE_TYPE
           FROM ${ORACLE_OBJECTS.WORKLISTS_V}
          WHERE FROM_ROLE = :username
            AND STATUS = 'OPEN'
            AND BEGIN_DATE >= SYSDATE - (1 / 1440)
            AND BEGIN_DATE <= SYSDATE
          ORDER BY BEGIN_DATE, NOTIFICATION_ID`,
        { username: login },
      );
      return rows.flatMap((row) => {
        const notificationId = str(row, 'NOTIFICATION_ID')?.trim();
        const recipient = str(row, 'RECIPIENT_ROLE')?.trim();
        const subject = str(row, 'SUBJECT');
        const fromUser = str(row, 'FROM_USER')?.replace(/\s+/g, ' ').trim();
        const requesterName = fromUser?.replace(/^\d+\s*-\s*/, '').trim();
        const normalizedSubject = subject?.replace(/\s+/g, ' ').trim();
        const suffix = fromUser ? ` for ${fromUser}` : undefined;
        const requestType =
          suffix && normalizedSubject?.toUpperCase().endsWith(suffix.toUpperCase())
            ? normalizedSubject.slice(0, -suffix.length).trim() || undefined
            : undefined;
        return notificationId && recipient
          ? [
              {
                notificationId,
                recipient,
                subject,
                requesterName:
                  requesterName && !/^\d+$/.test(requesterName) ? requesterName : undefined,
                requestType,
                itemKey: str(row, 'ITEM_KEY')?.trim() || undefined,
                itemType: str(row, 'MESSAGE_TYPE')?.trim() || undefined,
              },
            ]
          : [];
      });
    });
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
        const rows = await this.query<Row>(`SELECT * FROM ${object} WHERE notification_id = :id`, {
          id: notificationId,
        });
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
      requestorName: str(row, 'REQUESTOR_NAME')?.trim() || undefined,
      approverName: str(row, 'APPROVER_NAME')?.trim() || undefined,
      requestType:
        str(row, 'REQUEST_TYPE')?.trim() || str(row, 'SERVICE_REQUEST')?.trim() || undefined,
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
      const login = str(rows[0] ?? {}, 'USER_NAME')?.trim();
      if (login) cache.set(trimmed, login);
    }
    return cache.get(trimmed);
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
      return undefined;
    }
  }
}
