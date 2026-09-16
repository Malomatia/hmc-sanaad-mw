import { Logger } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { EmployeeIdentity } from '../../domain/auth-identity';
import { OracleLoginEmploymentRepository } from './oracle-login-employment.repository';

const IDENTITY: EmployeeIdentity = {
  username: 'hmc1',
  employeeNumber: '037400',
  employeeName: 'Test Employee',
  employeeNameAr: 'موظف تجريبي',
  facilityId: '456',
  facility: 'SQL facility.Hospital',
  jobId: '123',
  jobName: 'SQL job.HMC',
  isEmployee: true,
  isNewUser: false,
};

const EMPLOYMENT = {
  JOB: 'Oracle job',
  JOB_AR: 'المسمى الوظيفي',
  ORG: 'Oracle organization',
  ORG_AR: 'المؤسسة',
  USER_NAME: 'HMC1',
};
const DETAILS = {
  organizationName: EMPLOYMENT.ORG,
  organizationNameAr: EMPLOYMENT.ORG_AR,
  jobTitle: EMPLOYMENT.JOB,
  jobTitleAr: EMPLOYMENT.JOB_AR,
};
const FALLBACK = {
  organizationName: IDENTITY.facility,
  organizationNameAr: IDENTITY.facility,
  jobTitle: IDENTITY.jobName,
  jobTitleAr: IDENTITY.jobName,
};
const SQL =
  "SELECT REGEXP_SUBSTR(DEPARTMENT, '[^.]+$') AS ORG, " +
  "REGEXP_SUBSTR(DEPARTMENT_AR, '^[^.]+') AS ORG_AR, " +
  "REGEXP_SUBSTR(JOB, '[^.]+', 1, 2) AS JOB, " +
  "REGEXP_SUBSTR(JOB_AR, '[^.]+', 1, 2) AS JOB_AR, " +
  'USER_NAME FROM APPS.XXHMC_SND_EMPLOYMENT_DETAILS_V ' +
  'WHERE USER_NAME = :username AND ROWNUM <= 1';

function makeRepository() {
  const ora = {
    isConfigured: jest.fn().mockReturnValue(true),
    query: jest.fn().mockResolvedValue([EMPLOYMENT]),
  };
  const repository = new OracleLoginEmploymentRepository(ora as unknown as OracleService);
  return { ora, repository };
}

describe('OracleLoginEmploymentRepository', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('extracts all four labels with Oracle regexes in one username-scoped query', async () => {
    const { ora, repository } = makeRepository();

    await expect(repository.resolve(IDENTITY)).resolves.toEqual(DETAILS);
    expect(ora.query).toHaveBeenCalledTimes(1);
    expect(ora.query).toHaveBeenCalledWith(SQL, { username: 'HMC1' });
  });

  it.each(['aibrahim39', 'AiBrAhIm39', 'AIBRAHIM39'])(
    'uppercases the Oracle username %s without changing the identity',
    async (username) => {
      const { ora, repository } = makeRepository();
      const identity = Object.freeze({ ...IDENTITY, username });

      await expect(repository.resolve(identity)).resolves.toEqual(DETAILS);
      expect(ora.query).toHaveBeenCalledWith(SQL, { username: 'AIBRAHIM39' });
      expect(identity.username).toBe(username);
    },
  );

  it('does not require job or facility IDs for the username lookup', async () => {
    const { ora, repository } = makeRepository();

    await expect(
      repository.resolve({ ...IDENTITY, jobId: undefined, facilityId: undefined }),
    ).resolves.toEqual(DETAILS);
    expect(ora.query).toHaveBeenCalledTimes(1);
    expect(ora.query).toHaveBeenCalledWith(SQL, { username: 'HMC1' });
  });

  it.each([
    'ORA-00942: table or view does not exist',
    'ORA-01013: operation cancelled',
    'ORA-01031: insufficient privileges',
    'Oracle pool is unavailable',
  ])('returns both SQL fallback pairs on %s', async (message) => {
    const { ora, repository } = makeRepository();
    ora.query.mockRejectedValue(new Error(message));

    await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
    expect(ora.query).toHaveBeenCalledTimes(1);
  });

  it('returns SQL fallbacks without querying when Oracle is disabled or unconfigured', async () => {
    const { ora, repository } = makeRepository();
    ora.isConfigured.mockReturnValue(false);

    await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
    expect(ora.query).not.toHaveBeenCalled();
  });

  it('uses SQL fallbacks when the employment view has no matching row', async () => {
    const { ora, repository } = makeRepository();
    ora.query.mockResolvedValue([]);

    await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
  });

  it.each([null, undefined, '', '   '])(
    'falls back for missing or blank labels: %s',
    async (value) => {
      const { ora, repository } = makeRepository();
      ora.query.mockResolvedValue([{ JOB: value, JOB_AR: value, ORG: value, ORG_AR: value }]);

      await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
    },
  );

  it('preserves populated Oracle labels and falls back independently for the others', async () => {
    const { ora, repository } = makeRepository();
    ora.query.mockResolvedValue([
      {
        JOB: '   ',
        JOB_AR: ' المسمى الوظيفي ',
        ORG: ' Oracle organization ',
        ORG_AR: null,
      },
    ]);

    await expect(repository.resolve(IDENTITY)).resolves.toEqual({
      organizationName: 'Oracle organization',
      organizationNameAr: IDENTITY.facility,
      jobTitle: IDENTITY.jobName,
      jobTitleAr: 'المسمى الوظيفي',
    });
  });

  it.each([
    [
      { JOB: null, JOB_AR: null },
      { ...DETAILS, jobTitle: IDENTITY.jobName, jobTitleAr: IDENTITY.jobName },
    ],
    [
      { ORG: null, ORG_AR: null },
      { ...DETAILS, organizationName: IDENTITY.facility, organizationNameAr: IDENTITY.facility },
    ],
  ])(
    'keeps SQL fallback text unmodified when regexes return no match: %j',
    async (columns, expected) => {
      const { ora, repository } = makeRepository();
      ora.query.mockResolvedValue([{ ...EMPLOYMENT, ...columns }]);

      await expect(repository.resolve(IDENTITY)).resolves.toEqual(expected);
    },
  );

  it.each(['', ' ', '\t'])(
    'never queries an unscoped view for a blank username: %s',
    async (username) => {
      const { ora, repository } = makeRepository();

      await expect(repository.resolve({ ...IDENTITY, username })).resolves.toEqual(FALLBACK);
      expect(ora.query).not.toHaveBeenCalled();
    },
  );

  it('keeps username content in a bind rather than interpolating it into SQL', async () => {
    const { ora, repository } = makeRepository();
    const username = "hmc1' OR '1'='1";

    await repository.resolve({ ...IDENTITY, username });

    expect(ora.query).toHaveBeenCalledWith(SQL, { username: username.toUpperCase() });
    expect(ora.query.mock.calls[0][0]).not.toContain(username);
  });

  it('does not invent labels when neither database supplies them', async () => {
    const { ora, repository } = makeRepository();
    ora.query.mockResolvedValue([]);

    await expect(
      repository.resolve({ ...IDENTITY, jobName: undefined, facility: undefined }),
    ).resolves.toEqual({
      organizationName: undefined,
      organizationNameAr: undefined,
      jobTitle: undefined,
      jobTitleAr: undefined,
    });
  });
});
