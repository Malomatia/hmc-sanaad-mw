import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { SchemaColumnNotFoundException } from '@core/database/schema-column-not-found.error';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { USERNAME_KEY_CANDIDATES } from '@shared/constants/oracle-columns';
import { ProfileOracleRepository } from './profile.oracle.repository';

const OUTSIDE = ORACLE_OBJECTS.EMP_OUT_ADDRESS_V;
const INSIDE_ROWS = [
  { ADDRESS_ID: '101', ADDRESS_TYPE: 'Primary Local Address' },
  { ADDRESS_ID: '102', ADDRESS_TYPE: 'HMC Accommodation Address' },
];

function make(keyColumn = 'USER_NAME') {
  const query = jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes(OUTSIDE)) return [{ ADDRESS_ID: '201', ADDRESS_TYPE: 'Recruiting' }];
    if (sql.includes(ORACLE_OBJECTS.EMP_IN_ADDRESS_V)) return INSIDE_ROWS;
    return [];
  });
  const resolveKeyColumn = jest.fn().mockResolvedValue(keyColumn);
  const repository = new ProfileOracleRepository(
    { query } as unknown as OracleService,
    { resolveKeyColumn } as unknown as OracleSchemaService,
  );
  return { repository, query, resolveKeyColumn };
}

describe('Profile outside address selection', () => {
  it.each(['USER_NAME', 'USERNAME'])(
    'filters address types and limits the scoped Oracle query to one row using %s',
    async (keyColumn) => {
      const { repository, query, resolveKeyColumn } = make(keyColumn);
      const profile = await repository.getProfile('aibrahim39', 'en');

      expect(resolveKeyColumn).toHaveBeenCalledWith(OUTSIDE, USERNAME_KEY_CANDIDATES);
      expect(query).toHaveBeenCalledWith(
        `SELECT * FROM ${OUTSIDE} WHERE ${keyColumn} IN (:k0) ` +
          'AND (ADDRESS_TYPE IN (:addressType0, :addressType1)) AND ROWNUM <= :maxRows',
        {
          k0: 'AIBRAHIM39',
          addressType0: 'Recruiting',
          addressType1: 'Primary Home Country Address',
          maxRows: 1,
        },
      );
      expect(profile.outsideAddresses).toEqual([{ addressId: '201', addressType: 'Recruiting' }]);
    },
  );

  it('does not filter or limit the other profile reads', async () => {
    const { repository, query } = make();
    const profile = await repository.getProfile('aibrahim39', 'ar');
    const otherCalls = query.mock.calls.filter(([sql]) => !sql.includes(OUTSIDE));

    expect(otherCalls).toHaveLength(4);
    for (const [sql, binds] of otherCalls) {
      expect(sql).not.toMatch(/ADDRESS_TYPE IN|ROWNUM/);
      expect(binds).toEqual({ k0: 'AIBRAHIM39' });
    }
    expect(profile.insideAddresses).toHaveLength(2);
  });

  it('keeps an empty address array when Oracle finds no matching row', async () => {
    const { repository, query } = make();
    query.mockResolvedValue([]);
    expect((await repository.getProfile('AIBRAHIM39', 'en')).outsideAddresses).toEqual([]);
  });

  it('preserves partial-profile behavior if the outside-address scope column is unavailable', async () => {
    const { repository, query, resolveKeyColumn } = make();
    resolveKeyColumn.mockImplementation(async (object: string) => {
      if (object === OUTSIDE) {
        throw new SchemaColumnNotFoundException(OUTSIDE, USERNAME_KEY_CANDIDATES, ['ADDRESS_TYPE']);
      }
      return 'USER_NAME';
    });

    const profile = await repository.getProfile('AIBRAHIM39', 'en');

    expect(profile.outsideAddresses).toEqual([]);
    expect(profile.insideAddresses).toHaveLength(2);
    expect(query.mock.calls.every(([sql]) => !sql.includes(OUTSIDE))).toBe(true);
  });

  it('does not swallow unrelated Oracle failures', async () => {
    const { repository, query } = make();
    const failure = new Error('Oracle query failed');
    query.mockRejectedValue(failure);
    await expect(repository.getProfile('AIBRAHIM39', 'en')).rejects.toBe(failure);
  });
});
