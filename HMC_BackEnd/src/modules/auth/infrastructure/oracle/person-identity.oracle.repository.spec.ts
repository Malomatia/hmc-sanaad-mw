import { OracleService } from '@core/database/oracle.service';
import { PersonIdentityOracleRepository } from './person-identity.oracle.repository';

function make(ready = true) {
  const query = jest.fn().mockResolvedValue([{ PERSON_ID: 26023 }]);
  const oracle = { isReady: () => ready, query } as unknown as OracleService;
  return { repo: new PersonIdentityOracleRepository(oracle), query };
}

describe('Oracle login person identity', () => {
  it('reads only PERSON_ID with a bound normalized username', async () => {
    const { repo, query } = make();
    expect(await repo.findPersonId('mixed.User')).toBe('26023');
    expect(query).toHaveBeenCalledWith(
      'SELECT PERSON_ID FROM XXHMC_SND_EMPLOYMENT_DETAILS_V WHERE USER_NAME = :username',
      { username: 'MIXED.USER' },
    );
  });

  it('does not start on-demand recovery when no warmed pool is available', async () => {
    const { repo, query } = make(false);
    expect(await repo.findPersonId('user')).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    { rows: [{ PERSON_ID: null }] },
    { rows: [{ PERSON_ID: '' }] },
    { rows: [{ PERSON_ID: 'invalid' }] },
    { rows: [{ PERSON_ID: 26023 }, { PERSON_ID: 123 }] },
    { rows: [{ PERSON_ID: 26023 }, { PERSON_ID: null }] },
    { rows: [{ PERSON_ID: Number.MAX_SAFE_INTEGER + 1 }] },
  ])('omits missing or ambiguous identity $rows', async ({ rows }) => {
    const { repo, query } = make();
    query.mockResolvedValue(rows);
    expect(await repo.findPersonId('user')).toBeUndefined();
  });

  it('accepts duplicate rows referring to the same person', async () => {
    const { repo, query } = make();
    query.mockResolvedValue([{ PERSON_ID: '026023' }, { PERSON_ID: 26023 }]);
    expect(await repo.findPersonId('user')).toBe('26023');
  });

  it('lets the application boundary handle a query failure', async () => {
    const { repo, query } = make();
    const error = new Error('Oracle unavailable');
    query.mockRejectedValue(error);
    await expect(repo.findPersonId('user')).rejects.toBe(error);
  });
});
