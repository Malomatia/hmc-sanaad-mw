import { BaseOracleRepository } from './base.repository';
import { OracleService } from './oracle.service';
import { OracleSchemaService } from './oracle-schema.service';
import { WorklistOracleRepository } from '@modules/approvals/infrastructure/oracle/approvals.oracle.repository';
import { SupervisorOracleRepository } from '@modules/employee/infrastructure/oracle/employee.oracle.repository';
import { LeaveOracleRepository } from '@modules/leave/infrastructure/oracle/leave.oracle.repository';
import { SchoolFeeOracleRepository } from '@modules/school-fees/infrastructure/oracle/school-fees.oracle.repository';

class TestRepository extends BaseOracleRepository {
  readUsername(username: string) {
    return this.readByUsername('TEST_VIEW', username);
  }

  readEmployee(value: string, column: string) {
    return this.readByEmployee('TEST_VIEW', value, column);
  }

  readKeys(values: string[], column: string) {
    return this.readByResolvedKeyAny('TEST_VIEW', values, [column]);
  }

  readIds(values: string[], column: string) {
    return this.readByResolvedKeyIn('TEST_VIEW', values, [column]);
  }
}

function make() {
  const query = jest.fn().mockResolvedValue([]);
  const ora = { query } as unknown as OracleService;
  const schema = {
    resolveKeyColumn: jest.fn(async (_object: string, candidates: string[]) => candidates[0]),
    resolveParams: jest.fn().mockResolvedValue([]),
    resolveSignature: jest.fn().mockResolvedValue(undefined),
  };
  return { query, ora, schema, dictionary: schema as unknown as OracleSchemaService };
}

describe('Oracle usernames behind generic bind names', () => {
  it('uppercases username reads using the u bind', async () => {
    const { ora, query } = make();
    await new TestRepository(ora).readUsername('mixed.User');
    expect(query).toHaveBeenCalledWith(expect.any(String), { u: 'MIXED.USER' });
  });

  it.each([
    ['user_name', 'mixed.User', 'MIXED.USER'],
    ['employee_number', 'emp-001', 'emp-001'],
    ['employee_number', '0037400', '0037400'],
  ])('normalizes enum binds only for a username column: %s', async (column, value, expected) => {
    const { ora, query } = make();
    await new TestRepository(ora).readEmployee(value, column);
    expect(query).toHaveBeenCalledWith(expect.any(String), { enum: expected });
  });

  describe.each(['readKeys', 'readIds'] as const)('%s', (method) => {
    it.each(['username', 'USER_NAME', 'REQUESTOR_USER_NAME', 'approver_user_name'])(
      'uppercases values scoped by %s, preserving numeric identities',
      async (column) => {
        const { ora, query, dictionary } = make();
        const values = ['mixed.User', '0037400'];
        await new TestRepository(ora, dictionary)[method](values, column);
        expect(query).toHaveBeenCalledWith(expect.any(String), {
          k0: 'MIXED.USER',
          k1: '0037400',
        });
        expect(values).toEqual(['mixed.User', '0037400']);
      },
    );

    it('does not uppercase unrelated identifiers', async () => {
      const { ora, query, dictionary } = make();
      await new TestRepository(ora, dictionary)[method](['case-Sensitive'], 'dependent_id');
      expect(query).toHaveBeenCalledWith(expect.any(String), { k0: 'case-Sensitive' });
    });
  });

  it.each([undefined, 'notification-aB'])(
    'uppercases worklist scopes with notification %s',
    async (id) => {
      const { ora, query } = make();
      await new WorklistOracleRepository(ora).getWorklistSummary('mixed.User', 'en', id);
      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        id ? { u: 'MIXED.USER', id } : { u: 'MIXED.USER' },
      );
    },
  );

  it('uppercases leave-history usernames without changing the leave type', async () => {
    const { ora, query, dictionary } = make();
    await new LeaveOracleRepository(ora, dictionary).list({
      username: 'mixed.User',
      leaveType: 'Annual Leave',
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), { u: 'MIXED.USER', t: 'Annual Leave' });
  });

  it('uppercases the supervisor table-function username before it becomes arg0', async () => {
    const { ora, query, dictionary } = make();
    await new SupervisorOracleRepository(ora, dictionary).getSupervisorViews('mixed.User', 'en');
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      arg0: 'MIXED.USER',
      arg1: null,
      maxRows: 2000,
    });
  });

  it('normalizes dictionary-resolved table-function usernames but not other arguments', async () => {
    const { ora, query, schema, dictionary } = make();
    schema.resolveSignature.mockResolvedValue({
      params: [{ name: 'p_acad_yr_strt_dt' }, { name: 'p_user_name' }],
      returnType: { dataType: 'TABLE' },
    });
    await new SchoolFeeOracleRepository(ora, dictionary).getChildren({
      employeeNumber: 'mixed.User',
      academicYearStartDate: '01-Sep-2026',
      lang: 'en',
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), {
      arg0: '01-Sep-2026',
      arg1: 'MIXED.USER',
      maxRows: 2000,
    });
  });
});
