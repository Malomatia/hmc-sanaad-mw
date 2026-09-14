import { NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MotcSmsDbService } from '@core/database/motc-sms-db.service';
import { MssqlUserRepository } from './mssql-user.repository';

function makeDb() {
  return { query: jest.fn(), execute: jest.fn() } as unknown as jest.Mocked<MotcSmsDbService>;
}

function makeConfig(view = 'HMC_SND_LIV_EMP_MASTER_VW') {
  return {
    getOrThrow: jest.fn().mockReturnValue({ employeeMasterView: view }),
  } as unknown as ConfigService;
}

const QUERY = { username: 'MKHOJA', imei: 'imei-1', platform: 'Android' };

describe('MssqlUserRepository (AUTH_DIRECTORY=usersdb)', () => {
  it('resolves identity from the live-employee master view by UserName', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([
      {
        EMPLOYEE_NUMBER: '011759',
        EMPLOYEE_NAME: 'Mouna Bent Abdelkerim Khoja',
        JOB_NAME: 'Cardiac and Cardiovascular Surgery Technologist.H',
        MOBILE_NUMBER: '55372169',
        EMAIL_ADDRESS: 'MKHOJA@hamad.qa',
        DEPARTMENT_DESC: 'Cardiothoracic Surgery.Heart Hospital',
        UserName: 'MKHOJA',
      },
    ]);

    const identity = await new MssqlUserRepository(db, makeConfig()).validate(QUERY);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM HMC_SND_LIV_EMP_MASTER_VW[\s\S]*WHERE UserName = @username/),
      { username: 'MKHOJA' },
    );
    expect(identity).toMatchObject({
      username: 'MKHOJA',
      employeeNumber: '011759',
      employeeName: 'Mouna Bent Abdelkerim Khoja',
      department: 'Cardiothoracic Surgery.Heart Hospital',
      phoneNumber: '55372169',
      isEmployee: true,
    });
  });

  it('refuses a username absent from the view (isEmployee: false)', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([]);

    const identity = await new MssqlUserRepository(db, makeConfig()).validate(QUERY);

    expect(identity).toMatchObject({
      username: 'MKHOJA',
      isEmployee: false,
      isNewUser: true,
    });
  });

  it('tolerates a NULL MOBILE_NUMBER (identity resolves, phone undefined)', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([
      { EMPLOYEE_NUMBER: '462785', EMPLOYEE_NAME: 'Lenyl Dagamac', MOBILE_NUMBER: null, UserName: 'LDagamac' },
    ]);

    const identity = await new MssqlUserRepository(db, makeConfig()).validate({
      ...QUERY,
      username: 'LDagamac',
    });

    expect(identity).toMatchObject({
      username: 'LDagamac',
      employeeName: 'Lenyl Dagamac',
      phoneNumber: undefined,
      isEmployee: true,
    });
  });

  it('rejects a non-identifier view name at construction', () => {
    expect(() => new MssqlUserRepository(makeDb(), makeConfig('bad name; DROP'))).toThrow(
      /not a SQL identifier/,
    );
  });

  it('authenticate() is not part of the Users-DB journey (501)', () => {
    expect(() =>
      new MssqlUserRepository(makeDb(), makeConfig()).authenticate({
        username: 'MKHOJA',
        password: 'x',
      }),
    ).toThrow(NotImplementedException);
  });
});
