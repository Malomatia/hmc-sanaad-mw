import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleRequestLookupRepository } from './oracle-request-lookup.repository';

const START = new Date('2026-09-15T08:00:00.000Z');
const END = new Date('2026-09-15T08:02:00.000Z');

describe('worklist notification lookup', () => {
  function make(rows: Record<string, unknown>[] = []) {
    const query = jest.fn().mockResolvedValue(rows);
    const repo = new OracleRequestLookupRepository(
      { query } as unknown as OracleService,
      {} as OracleSchemaService,
    );
    return { repo, query };
  }

  it('uses only the scoped OPEN worklist query and explicit native date binds', async () => {
    const { repo, query } = make();
    await repo.findWorklistNotifications(' actor ', START, END);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, binds] = query.mock.calls[0];
    expect(sql).toContain('SELECT NOTIFICATION_ID, FROM_ROLE, RECIPIENT_ROLE, SUBJECT,');
    expect(sql).toContain('BEGIN_DATE, ITEM_KEY, MESSAGE_TYPE');
    expect(sql).toContain('FROM XXHMC_SND_WORKLISTS_V');
    expect(sql).toContain('FROM_ROLE = :username');
    expect(sql).toContain("STATUS = 'OPEN'");
    expect(sql).toContain('BEGIN_DATE >= :window_start');
    expect(sql).toContain('BEGIN_DATE <= :window_end');
    expect(sql).toContain('ORDER BY BEGIN_DATE, NOTIFICATION_ID');
    expect(sql).not.toMatch(
      /SELECT \*|TRUNC\(|UPPER\(FROM_ROLE\)|ALL_ARGUMENTS|ALL_TAB_COLUMNS|MY_REQEST_SUMMARY_V/,
    );
    expect(binds).toEqual({
      username: 'ACTOR',
      window_start: { dir: oracledb.BIND_IN, type: oracledb.DB_TYPE_DATE, val: START },
      window_end: { dir: oracledb.BIND_IN, type: oracledb.DB_TYPE_DATE, val: END },
    });
  });

  it('does not interpolate a supplied username into SQL', async () => {
    const { repo, query } = make();
    const username = "actor' OR '1'='1";
    await repo.findWorklistNotifications(username, START, END);
    expect(query.mock.calls[0][0]).not.toContain(username);
    expect(query.mock.calls[0][1].username).toBe(username.toUpperCase());
  });

  it('maps only usable IDs and RECIPIENT_ROLE logins, preserving SUBJECT and MESSAGE_TYPE', async () => {
    const { repo } = make([
      {
        NOTIFICATION_ID: 123,
        RECIPIENT_ROLE: ' APPROVER ',
        SUBJECT: '  Leave request  ',
        ITEM_KEY: 456,
        MESSAGE_TYPE: 'HRSSA',
        TYPE: 'WRONG',
        TO_USER: 'Display Name',
      },
      {
        NOTIFICATION_ID: 124,
        RECIPIENT_ROLE: 'OTHER',
        SUBJECT: null,
        ITEM_KEY: null,
        MESSAGE_TYPE: null,
      },
      { NOTIFICATION_ID: null, RECIPIENT_ROLE: 'APPROVER' },
      { NOTIFICATION_ID: ' ', RECIPIENT_ROLE: 'APPROVER' },
      {
        NOTIFICATION_ID: 125,
        RECIPIENT_ROLE: ' ',
        TO_USER: 'Display Name',
        MORE_INFO_ROLE: 'OTHER',
        ORIGINAL_RECIPIENT: 'OTHER',
      },
    ]);
    expect(await repo.findWorklistNotifications('ACTOR', START, END)).toEqual([
      {
        notificationId: '123',
        recipient: 'APPROVER',
        subject: '  Leave request  ',
        itemKey: '456',
        itemType: 'HRSSA',
      },
      {
        notificationId: '124',
        recipient: 'OTHER',
        subject: undefined,
        itemKey: undefined,
        itemType: undefined,
      },
    ]);
  });

  it('excludes old, closed, future and other-submitter fixtures under the SQL predicates', async () => {
    const { repo, query } = make();
    const current = {
      NOTIFICATION_ID: 123,
      FROM_ROLE: 'ACTOR',
      RECIPIENT_ROLE: 'APPROVER',
      STATUS: 'OPEN',
      BEGIN_DATE: START,
    };
    const fixtures = [
      current,
      { ...current, NOTIFICATION_ID: 124, BEGIN_DATE: new Date(START.getTime() - 1000) },
      { ...current, NOTIFICATION_ID: 125, STATUS: 'CLOSED' },
      { ...current, NOTIFICATION_ID: 126, BEGIN_DATE: new Date(END.getTime() + 1000) },
      { ...current, NOTIFICATION_ID: 127, FROM_ROLE: 'OTHER' },
    ];
    query.mockImplementation(async (_sql, binds) =>
      fixtures.filter(
        (row) =>
          row.FROM_ROLE === binds.username &&
          row.STATUS === 'OPEN' &&
          row.BEGIN_DATE >= binds.window_start.val &&
          row.BEGIN_DATE <= binds.window_end.val,
      ),
    );
    expect(await repo.findWorklistNotifications('ACTOR', START, END)).toEqual([
      expect.objectContaining({ notificationId: '123', recipient: 'APPROVER' }),
    ]);
  });

  it('returns no result on Oracle failure without falling back to another query', async () => {
    const { repo, query } = make();
    query.mockRejectedValue(new Error('Oracle unavailable'));
    await expect(repo.findWorklistNotifications('ACTOR', START, END)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['', START, END],
    ['ACTOR', END, START],
    ['ACTOR', new Date('invalid'), END],
  ])('does not query with invalid caller/window inputs', async (username, start, end) => {
    const { repo, query } = make();
    await expect(
      repo.findWorklistNotifications(username as string, start as Date, end as Date),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
