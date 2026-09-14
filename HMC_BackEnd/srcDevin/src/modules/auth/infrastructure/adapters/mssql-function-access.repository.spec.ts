import { ConfigService } from '@nestjs/config';
import { MssqlService } from '@core/database/mssql.service';
import { FunctionStatus } from '../../domain/auth-identity';
import { MssqlFunctionAccessRepository } from './mssql-function-access.repository';

function makeDb() {
  return { query: jest.fn(), execute: jest.fn() } as unknown as jest.Mocked<MssqlService>;
}

function makeConfig(view = 'HMC_Sanad_AppMaster_VW', appName = '') {
  return {
    getOrThrow: jest.fn().mockReturnValue({ functionAccessView: view, functionAccessAppId: 1 }),
    get: jest.fn().mockReturnValue(appName),
  } as unknown as ConfigService;
}

describe('MssqlFunctionAccessRepository', () => {
  it('runs the documented AppMaster query and maps name/code/description/statuscode', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([
      { FunctionName: 'Payroll SSRS', FunctionCode: 'PYSRS', Description: 'Payroll', StatusCode: '1' },
      { FunctionName: 'Housing', FunctionCode: 'HOUSNG', Description: null, StatusCode: '2' },
      { FunctionName: 'Letters', FunctionCode: 'LETTER', Description: '', StatusCode: '0' },
    ]);

    const list = await new MssqlFunctionAccessRepository(db, makeConfig()).list('053613');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /SELECT A\.FunctionName, A\.FunctionCode, A\.Description, A\.StatusCode[\s\S]*FROM HMC_Sanad_AppMaster_VW A WHERE A\.AppID = @appId/,
      ),
      { appId: 1 },
    );
    expect(list).toEqual([
      {
        functionname: 'Payroll SSRS',
        functioncode: 'PYSRS',
        remarks: 'Payroll',
        status: FunctionStatus.ENABLED,
      },
      {
        functionname: 'Housing',
        functioncode: 'HOUSNG',
        remarks: '',
        status: FunctionStatus.COMING_SOON,
      },
      {
        functionname: 'Letters',
        functioncode: 'LETTER',
        remarks: '',
        status: FunctionStatus.DISABLED,
      },
    ]);
  });

  it('normalizes legacy status spellings (bit/yes-no/text)', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([
      { FunctionName: 'A', FunctionCode: 'A', Status: true },
      { FunctionName: 'B', FunctionCode: 'B', Status: 'Y' },
      { FunctionName: 'C', FunctionCode: 'C', Status: 'Coming Soon' },
      { FunctionName: 'D', FunctionCode: 'D', Status: 'N' },
    ]);

    const list = await new MssqlFunctionAccessRepository(db, makeConfig()).list('053613');

    expect(list.map((f) => f.status)).toEqual([
      FunctionStatus.ENABLED,
      FunctionStatus.ENABLED,
      FunctionStatus.COMING_SOON,
      FunctionStatus.DISABLED,
    ]);
  });

  it('filters by a per-user column when the view has one', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([
      { LoginID: 'hmc1', FunctionName: 'Leave', FunctionCode: 'LEAVE', Status: '1' },
      { LoginID: 'hmc2', FunctionName: 'Leave', FunctionCode: 'LEAVE', Status: '0' },
    ]);

    const list = await new MssqlFunctionAccessRepository(db, makeConfig()).list('hmc1');

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ functioncode: 'LEAVE', status: FunctionStatus.ENABLED });
  });

  it('scopes by AppName when configured, falling back to all rows when nothing matches', async () => {
    const db = makeDb();
    const rows = [
      { AppName: 'Sanaad', FunctionName: 'Leave', FunctionCode: 'LEAVE', Status: '1' },
      { AppName: 'OtherApp', FunctionName: 'X', FunctionCode: 'X', Status: '1' },
    ];
    db.query.mockResolvedValue(rows);

    const scoped = await new MssqlFunctionAccessRepository(
      db,
      makeConfig('HMC_Sanad_AppMaster_VW', 'Sanaad'),
    ).list('hmc1');
    expect(scoped.map((f) => f.functioncode)).toEqual(['LEAVE']);

    db.query.mockResolvedValue(rows);
    const unscoped = await new MssqlFunctionAccessRepository(
      db,
      makeConfig('HMC_Sanad_AppMaster_VW', 'NoSuchApp'),
    ).list('hmc1');
    expect(unscoped).toHaveLength(2);
  });

  it('returns [] when the view is empty and treats a missing status column as ENABLED', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    const repo = new MssqlFunctionAccessRepository(db, makeConfig());
    expect(await repo.list('hmc1')).toEqual([]);

    db.query.mockResolvedValueOnce([{ FunctionName: 'Leave', FunctionCode: 'LEAVE' }]);
    const list = await repo.list('hmc1');
    expect(list[0].status).toBe(FunctionStatus.ENABLED);
  });

  it('throws with the actual column list when name/code cannot be resolved', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([{ Foo: 1, Bar: 2 }]);

    await expect(new MssqlFunctionAccessRepository(db, makeConfig()).list('hmc1')).rejects.toThrow(
      /actual columns: \[Foo, Bar\]/,
    );
  });

  it('falls back to SELECT * with tolerant mapping when the documented query fails', async () => {
    const db = makeDb();
    db.query
      .mockRejectedValueOnce(new Error("Invalid column name 'StatusCode'."))
      .mockResolvedValueOnce([{ FuncName: 'Leave', FuncCode: 'LEAVE', Remarks: 'r', Status: '1' }]);

    const list = await new MssqlFunctionAccessRepository(db, makeConfig()).list('053613');

    expect(db.query).toHaveBeenLastCalledWith('SELECT * FROM HMC_Sanad_AppMaster_VW');
    expect(list).toEqual([
      {
        functionname: 'Leave',
        functioncode: 'LEAVE',
        remarks: 'r',
        status: FunctionStatus.ENABLED,
      },
    ]);
  });

  it('rejects a non-identifier FUNCTION_ACCESS_VIEW at construction', () => {
    expect(() => new MssqlFunctionAccessRepository(makeDb(), makeConfig('x; DROP TABLE'))).toThrow(
      /not a SQL identifier/,
    );
  });
});
