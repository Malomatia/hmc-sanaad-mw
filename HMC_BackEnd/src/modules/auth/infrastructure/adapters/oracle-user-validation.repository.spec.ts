import { Logger } from '@nestjs/common';
import oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleUserValidationRepository } from './oracle-user-validation.repository';

const SQL =
  'BEGIN XXHMC_SND_USER_VALIDATE_PRC(p_user_name => :p_user_name, p_is_valid => :p_is_valid); END;';

function makeRepository() {
  const ora = {
    isConfigured: jest.fn().mockReturnValue(true),
    call: jest.fn().mockResolvedValue({ p_is_valid: 'true' }),
  };
  const repository = new OracleUserValidationRepository(ora as unknown as OracleService);
  return { ora, repository };
}

describe('OracleUserValidationRepository', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('calls the supplied two-parameter procedure with an uppercase, bound request username', async () => {
    const { ora, repository } = makeRepository();

    await expect(repository.validate('hMc1')).resolves.toBe(true);
    expect(ora.call).toHaveBeenCalledTimes(1);
    expect(ora.call).toHaveBeenCalledWith(SQL, {
      p_user_name: 'HMC1',
      p_is_valid: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
    });
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    [' True ', true],
    ['false', false],
    ['FALSE', false],
    [' False ', false],
    ['', false],
    [null, false],
    [undefined, false],
    ['unexpected', false],
    ['1', false],
  ])('maps VARCHAR2 result %j to boolean %s', async (value, expected) => {
    const { ora, repository } = makeRepository();
    ora.call.mockResolvedValue({ p_is_valid: value });

    await expect(repository.validate('hmc1')).resolves.toBe(expected);
  });

  it.each([
    'Oracle pool is unavailable',
    'ORA-01013: operation cancelled',
    'ORA-01031: insufficient privileges',
    'PLS-00201: identifier must be declared',
  ])('returns false without throwing on %s', async (message) => {
    const { ora, repository } = makeRepository();
    ora.call.mockRejectedValue(new Error(message));

    await expect(repository.validate('hmc1')).resolves.toBe(false);
    expect(ora.call).toHaveBeenCalledTimes(1);
  });

  it('returns false without calling a disabled or unconfigured Oracle pool', async () => {
    const { ora, repository } = makeRepository();
    ora.isConfigured.mockReturnValue(false);

    await expect(repository.validate('hmc1')).resolves.toBe(false);
    expect(ora.call).not.toHaveBeenCalled();
  });

  it.each(['', ' ', '\t'])('refuses a blank username %j without calling Oracle', async (username) => {
    const { ora, repository } = makeRepository();

    await expect(repository.validate(username)).resolves.toBe(false);
    expect(ora.call).not.toHaveBeenCalled();
  });

  it('never interpolates the username into PL/SQL', async () => {
    const { ora, repository } = makeRepository();
    const username = "hmc1' OR '1'='1";

    await repository.validate(username);

    expect(ora.call).toHaveBeenCalledWith(SQL, expect.objectContaining({
      p_user_name: username.toUpperCase(),
    }));
    expect(SQL).not.toContain(username);
  });
});
