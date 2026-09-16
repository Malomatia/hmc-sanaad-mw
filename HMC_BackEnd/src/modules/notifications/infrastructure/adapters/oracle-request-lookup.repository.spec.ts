import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleRequestLookupRepository } from './oracle-request-lookup.repository';

const DATABASE_NOW = new Date('2026-09-16T18:06:00.000Z');

describe('worklist notification lookup', () => {
  function make(rows: Record<string, unknown>[] = []) {
    const query = jest.fn().mockResolvedValue(rows);
    const repo = new OracleRequestLookupRepository(
      { query } as unknown as OracleService,
      {} as OracleSchemaService,
    );
    return { repo, query };
  }

  it('uses the posted OPEN last-minute Oracle-clock query with only a username bind', async () => {
    const { repo, query } = make();
    await repo.findWorklistNotifications(' actor ');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, binds] = query.mock.calls[0];
    expect(sql).toContain('SELECT NOTIFICATION_ID, FROM_ROLE, FROM_USER, RECIPIENT_ROLE, SUBJECT,');
    expect(sql).toContain('BEGIN_DATE, ITEM_KEY, MESSAGE_TYPE');
    expect(sql).toContain('FROM XXHMC_SND_WORKLISTS_V');
    expect(sql).toContain('FROM_ROLE = :username');
    expect(sql).toContain("STATUS = 'OPEN'");
    expect(sql).toContain('BEGIN_DATE >= SYSDATE - (1 / 1440)');
    expect(sql).toContain('BEGIN_DATE <= SYSDATE');
    expect(sql).toContain('ORDER BY BEGIN_DATE, NOTIFICATION_ID');
    expect(sql).not.toMatch(
      /SELECT \*|TRUNC\(|UPPER\(FROM_ROLE\)|ALL_ARGUMENTS|ALL_TAB_COLUMNS|MY_REQEST_SUMMARY_V|:window_start|:window_end/,
    );
    expect(binds).toEqual({ username: 'ACTOR' });
  });

  it('does not interpolate a supplied username into SQL', async () => {
    const { repo, query } = make();
    const username = "actor' OR '1'='1";
    await repo.findWorklistNotifications(username);
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
    expect(await repo.findWorklistNotifications('ACTOR')).toEqual([
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

  it.each([
    ['Return from Leave for 038999    - Vandana Pavithran    ', 'Return from Leave'],
    ['Travel for Treatment for 038999 - Vandana Pavithran', 'Travel for Treatment'],
    ['Return from Leave FOR 038999 - VANDANA PAVITHRAN', 'Return from Leave'],
    ['Return from Leave for another employee', undefined],
    ['Return from Leave for 038999 - Vandana Pavithran with more details', undefined],
  ])(
    'derives a request name only from a matching FROM_USER suffix: %s',
    async (subject, requestType) => {
      const { repo } = make([
        {
          NOTIFICATION_ID: 123864402,
          FROM_ROLE: 'VPAVITHRAN',
          FROM_USER: '038999    - Vandana Pavithran',
          TO_USER: '037400 - Amir Ibrahim',
          RECIPIENT_ROLE: 'AIBRAHIM39',
          SUBJECT: subject,
          ITEM_KEY: '18876468',
          MESSAGE_TYPE: 'HRSSA',
          TYPE: 'HR',
        },
      ]);
      expect(await repo.findWorklistNotifications('VPAVITHRAN')).toEqual([
        {
          notificationId: '123864402',
          recipient: 'AIBRAHIM39',
          subject,
          requesterName: 'Vandana Pavithran',
          requestType,
          itemKey: '18876468',
          itemType: 'HRSSA',
        },
      ]);
    },
  );

  it('excludes old, closed, future and other-submitter fixtures using database time even if API time differs', async () => {
    const { repo, query } = make();
    const current = {
      NOTIFICATION_ID: 123,
      FROM_ROLE: 'ACTOR',
      RECIPIENT_ROLE: 'APPROVER',
      STATUS: 'OPEN',
      BEGIN_DATE: new Date('2026-09-16T18:05:46.000Z'),
    };
    const fixtures = [
      current,
      { ...current, NOTIFICATION_ID: 124, BEGIN_DATE: new Date(DATABASE_NOW.getTime() - 61000) },
      { ...current, NOTIFICATION_ID: 125, STATUS: 'CLOSED' },
      { ...current, NOTIFICATION_ID: 126, BEGIN_DATE: new Date(DATABASE_NOW.getTime() + 1000) },
      { ...current, NOTIFICATION_ID: 127, FROM_ROLE: 'OTHER' },
    ];
    query.mockImplementation(async (_sql, binds) =>
      fixtures.filter(
        (row) =>
          row.FROM_ROLE === binds.username &&
          row.STATUS === 'OPEN' &&
          row.BEGIN_DATE.getTime() >= DATABASE_NOW.getTime() - 60000 &&
          row.BEGIN_DATE <= DATABASE_NOW,
      ),
    );
    const clock = jest.spyOn(Date, 'now').mockReturnValue(DATABASE_NOW.getTime() - 3 * 3600000);
    try {
      expect(await repo.findWorklistNotifications('ACTOR')).toEqual([
        expect.objectContaining({ notificationId: '123', recipient: 'APPROVER' }),
      ]);
      expect(query.mock.calls[0][1]).toEqual({ username: 'ACTOR' });
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    { REQUEST_TYPE: ' Annual Leave ' },
    { REQUEST_TYPE: ' ', SERVICE_REQUEST: ' Annual Leave ' },
  ])(
    'maps request type and participant display names from existing lookup rows',
    async (requestName) => {
      const { repo, query } = make([
        {
          ...requestName,
          NOTIFICATION_ID: 123,
          REQUESTOR_USER_NAME: 'REQUESTER',
          REQUESTOR_NAME: ' Alice Requester ',
          APPROVER_USER_NAME: 'APPROVER',
          APPROVER_NAME: ' Bob Approver ',
        },
      ]);
      await expect(repo.findByNotificationId('123')).resolves.toEqual({
        notificationId: '123',
        requestType: 'Annual Leave',
        requestor: 'REQUESTER',
        requestorName: 'Alice Requester',
        approver: 'APPROVER',
        approverName: 'Bob Approver',
      });
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE notification_id = :id'), {
        id: '123',
      });
    },
  );

  it('returns no result on Oracle failure without falling back to another query', async () => {
    const { repo, query } = make();
    query.mockRejectedValue(new Error('Oracle unavailable'));
    await expect(repo.findWorklistNotifications('ACTOR')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each(['', ' ', '\t'])('does not query with a blank caller', async (username) => {
    const { repo, query } = make();
    await expect(repo.findWorklistNotifications(username)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
