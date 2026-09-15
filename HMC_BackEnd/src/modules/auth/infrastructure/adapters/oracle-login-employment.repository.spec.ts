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
  facility: 'SQL facility name',
  jobId: '123',
  jobName: 'SQL job name',
  isEmployee: true,
  isNewUser: false,
};

const ORGANIZATION = {
  ORGANIZATION_NAME: 'Oracle organization',
  ORGANIZATION_NAME_AR: 'المؤسسة',
};
const JOB = { JOB_TITLE: 'Oracle job', JOB_TITLE_AR: 'المسمى الوظيفي' };
const FALLBACK = {
  organizationName: IDENTITY.facility,
  organizationNameAr: IDENTITY.facility,
  jobTitle: IDENTITY.jobName,
  jobTitleAr: IDENTITY.jobName,
};

function makeRepository() {
  const ora = {
    isConfigured: jest.fn().mockReturnValue(true),
    query: jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('XXHMC_SND_ORG_DETAILS_V') ? [ORGANIZATION] : [JOB],
      ),
  };
  const repository = new OracleLoginEmploymentRepository(ora as unknown as OracleService);
  return { ora, repository };
}

describe('OracleLoginEmploymentRepository', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('uses HMCERP views with corresponding facility/job IDs and returns both languages', async () => {
    const { ora, repository } = makeRepository();

    await expect(repository.resolve(IDENTITY)).resolves.toEqual({
      organizationName: ORGANIZATION.ORGANIZATION_NAME,
      organizationNameAr: ORGANIZATION.ORGANIZATION_NAME_AR,
      jobTitle: JOB.JOB_TITLE,
      jobTitleAr: JOB.JOB_TITLE_AR,
    });
    expect(ora.query).toHaveBeenCalledTimes(2);
    expect(ora.query).toHaveBeenCalledWith(
      'SELECT ORGANIZATION_NAME, ORGANIZATION_NAME_AR FROM HMCERP.XXHMC_SND_ORG_DETAILS_V WHERE ORGANIZATION_ID = :id AND ROWNUM <= 1',
      { id: 456 },
    );
    expect(ora.query).toHaveBeenCalledWith(
      'SELECT JOB_TITLE, JOB_TITLE_AR FROM HMCERP.XXHMC_SND_JOB_DETAILS_V WHERE JOB_ID = :id AND ROWNUM <= 1',
      { id: 123 },
    );
  });

  it.each(['XXHMC_SND_ORG_DETAILS_V', 'XXHMC_SND_JOB_DETAILS_V'])(
    'falls back independently when %s fails',
    async (failedView) => {
      const { ora, repository } = makeRepository();
      ora.query.mockImplementation(async (sql: string) => {
        if (sql.includes(failedView)) throw new Error('ORA-00942: table or view does not exist');
        return sql.includes('XXHMC_SND_ORG_DETAILS_V') ? [ORGANIZATION] : [JOB];
      });

      await expect(repository.resolve(IDENTITY)).resolves.toEqual({
        organizationName:
          failedView === 'XXHMC_SND_ORG_DETAILS_V'
            ? IDENTITY.facility
            : ORGANIZATION.ORGANIZATION_NAME,
        organizationNameAr:
          failedView === 'XXHMC_SND_ORG_DETAILS_V'
            ? IDENTITY.facility
            : ORGANIZATION.ORGANIZATION_NAME_AR,
        jobTitle: failedView === 'XXHMC_SND_JOB_DETAILS_V' ? IDENTITY.jobName : JOB.JOB_TITLE,
        jobTitleAr: failedView === 'XXHMC_SND_JOB_DETAILS_V' ? IDENTITY.jobName : JOB.JOB_TITLE_AR,
      });
      expect(ora.query).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    'ORA-01013: operation cancelled',
    'ORA-01031: insufficient privileges',
    'Oracle pool is unavailable',
  ])(
    'returns both SQL fallback pairs on %s',
    async (message) => {
      const { ora, repository } = makeRepository();
      ora.query.mockRejectedValue(new Error(message));

      await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
    },
  );

  it('returns SQL fallbacks without querying when Oracle is disabled or unconfigured', async () => {
    const { ora, repository } = makeRepository();
    ora.isConfigured.mockReturnValue(false);

    await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
    expect(ora.query).not.toHaveBeenCalled();
  });

  it('uses SQL fallbacks when the Oracle views have no matching rows', async () => {
    const { ora, repository } = makeRepository();
    ora.query.mockResolvedValue([]);

    await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
  });

  it('falls back per language for null, empty, or whitespace-only labels', async () => {
    const { ora, repository } = makeRepository();
    ora.query
      .mockResolvedValueOnce([
        { ORGANIZATION_NAME: ' Oracle organization ', ORGANIZATION_NAME_AR: null },
      ])
      .mockResolvedValueOnce([{ JOB_TITLE: '   ', JOB_TITLE_AR: ' المسمى الوظيفي ' }]);

    await expect(repository.resolve(IDENTITY)).resolves.toEqual({
      organizationName: 'Oracle organization',
      organizationNameAr: IDENTITY.facility,
      jobTitle: IDENTITY.jobName,
      jobTitleAr: 'المسمى الوظيفي',
    });

    ora.query.mockResolvedValue([{}]);
    await expect(repository.resolve(IDENTITY)).resolves.toEqual(FALLBACK);
  });

  it.each([undefined, '', ' ', 'invalid', '1 OR 1=1', '1.5', '-1', '9007199254740992'])(
    'never queries an unscoped view when IDs are %s',
    async (id) => {
      const { ora, repository } = makeRepository();

      await expect(repository.resolve({ ...IDENTITY, facilityId: id, jobId: id })).resolves.toEqual(
        FALLBACK,
      );
      expect(ora.query).not.toHaveBeenCalled();
    },
  );

  it('still resolves the job when the facility ID is missing', async () => {
    const { ora, repository } = makeRepository();

    await expect(repository.resolve({ ...IDENTITY, facilityId: undefined })).resolves.toEqual({
      organizationName: IDENTITY.facility,
      organizationNameAr: IDENTITY.facility,
      jobTitle: JOB.JOB_TITLE,
      jobTitleAr: JOB.JOB_TITLE_AR,
    });
    expect(ora.query).toHaveBeenCalledTimes(1);
  });

  it('does not substitute a username or employee number for absent IDs', async () => {
    const { ora, repository } = makeRepository();

    await expect(
      repository.resolve({
        username: 'hmc1',
        employeeNumber: '037400',
        isEmployee: true,
        isNewUser: false,
      }),
    ).resolves.toEqual({
      organizationName: undefined,
      organizationNameAr: undefined,
      jobTitle: undefined,
      jobTitleAr: undefined,
    });
    expect(ora.query).not.toHaveBeenCalled();
  });

  it('starts both independent lookups without awaiting the first result', async () => {
    const { ora, repository } = makeRepository();
    let finishOrganization!: (rows: (typeof ORGANIZATION)[]) => void;
    ora.query.mockImplementation((sql: string) =>
      sql.includes('XXHMC_SND_ORG_DETAILS_V')
        ? new Promise((resolve) => {
            finishOrganization = resolve;
          })
        : Promise.resolve([JOB]),
    );

    const pending = repository.resolve(IDENTITY);
    expect(ora.query).toHaveBeenCalledTimes(2);
    finishOrganization([ORGANIZATION]);
    await expect(pending).resolves.toMatchObject({ jobTitle: JOB.JOB_TITLE });
  });
});
