import { ForbiddenException, Logger } from '@nestjs/common';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LookupsService } from '@lookups/application/lookups.service';
import { TicketCancelOptions, TicketRepository } from '../domain/annual-ticket.repository';
import { AnnualTicketService } from './annual-ticket.service';

const USER: AuthenticatedUser = { username: 'AIBRAHIM39', roles: [] };

/**
 * op 72 cancel-options is bound to the JWT caller (SEC-02 d): the three
 * cancellation views have no USER_NAME column, so the service resolves the
 * caller's PERSON_ID and never queries them with a client-supplied id.
 */
describe('AnnualTicketService.cancelOptions', () => {
  const OPTIONS: TicketCancelOptions = {
    tickets: [{ PERSON_ID: 26023, ANNUAL_LEAVE_PASS_TKT_VALUE: 'T' }],
    takenAs: [{ PERSON_ID: 26023, TAKES_AS: 'Cash' }],
    repaymentMethods: [{ PERSON_ID: 26023, FLEX_VALUE: 'Payroll Deduction' }],
  };

  function make(personId: string | null = '26023') {
    const repo = {
      apply: jest.fn(),
      cancel: jest.fn(),
      cancelOptions: jest.fn().mockResolvedValue(OPTIONS),
      resolvePersonId: jest.fn().mockResolvedValue(personId),
    } as jest.Mocked<TicketRepository>;
    const service = new AnnualTicketService(repo, {} as LookupsService);
    return { service, repo };
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('derives the PERSON_ID from the JWT username and reads the three views with it', async () => {
    const { service, repo } = make();

    await expect(service.cancelOptions(USER, {})).resolves.toEqual(OPTIONS);

    expect(repo.resolvePersonId).toHaveBeenCalledWith('AIBRAHIM39');
    expect(repo.cancelOptions).toHaveBeenCalledTimes(1);
    expect(repo.cancelOptions).toHaveBeenCalledWith('26023');
  });

  it.each(['26023', ' 26023 ', '026023'])(
    "accepts a client person_id equal to the caller's own (%p)",
    async (personId) => {
      const { service, repo } = make();

      await expect(service.cancelOptions(USER, { person_id: personId })).resolves.toEqual(OPTIONS);

      expect(repo.cancelOptions).toHaveBeenCalledWith('26023');
    },
  );

  it.each(['26024', 'abc', '26023 OR 1=1'])(
    "refuses a client person_id that is not the caller's (%p) with 403 and reads no view",
    async (personId) => {
      const { service, repo } = make();

      await expect(service.cancelOptions(USER, { person_id: personId })).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(repo.cancelOptions).not.toHaveBeenCalled();
    },
  );

  it('returns empty lists and reads no view when the caller has no PERSON_ID', async () => {
    const { service, repo } = make(null);
    const warn = jest.spyOn(Logger.prototype, 'warn');

    await expect(service.cancelOptions(USER, { person_id: '26023' })).resolves.toEqual({
      tickets: [],
      takenAs: [],
      repaymentMethods: [],
    });

    expect(repo.cancelOptions).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
