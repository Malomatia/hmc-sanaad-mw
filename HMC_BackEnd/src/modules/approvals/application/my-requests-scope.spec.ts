import { ApprovalsService } from './approvals.service';
import { ApprovalsRepository } from '../domain/approvals.repository';
import { AuthenticatedUser, Role } from '@core/auth/auth-user.interface';
import { ConfigService } from '@nestjs/config';

/** A non-production environment, where an explicit ?enum= is honoured. */
const nonProduction = () =>
  ({ getOrThrow: () => ({ nodeEnv: 'development' }) }) as unknown as ConfigService;

/**
 * op 23 lists what the CALLER submitted — their own data, not approver data —
 * so it is the one route on this controller that every employee may call. That
 * makes the scoping rule matter: the rows must follow the JWT, never a
 * client-supplied `enum`, or any employee could read another's requests by
 * passing their number.
 *
 * (Under the class-level @Roles the endpoint answered 403 for everyone, since
 * nothing in the system grants APPROVER/SUPERVISOR.)
 */
describe('op 23 — my requests scoping', () => {
  const CALLER: AuthenticatedUser = {
    username: 'AIBRAHIM39',
    employeeNumber: '037400',
    roles: [Role.EMPLOYEE],
  } as AuthenticatedUser;

  function make() {
    const getMyRequests = jest.fn().mockResolvedValue({ requests: [], pendingQid: [] });
    const getSummary = jest.fn().mockResolvedValue({ approvals: [], pendingQid: [] });
    const repo = { getMyRequests, getSummary } as unknown as ApprovalsRepository;
    return { service: new ApprovalsService(repo, nonProduction()), getMyRequests, getSummary };
  }

  it('queries both forms of the caller — the two views store different ones', async () => {
    const { service, getMyRequests } = make();

    await service.myRequests(CALLER, 'en');

    expect(getMyRequests).toHaveBeenCalledWith(['AIBRAHIM39', '037400'], 'en');
  });

  it('cannot be pointed at another employee', async () => {
    const { service, getMyRequests } = make();

    // there is no parameter to pass someone else's number through
    await service.myRequests(CALLER, 'en');

    const [keys] = getMyRequests.mock.calls[0] as [string[]];
    expect(keys).not.toContain('053613');
    expect(keys).toEqual(['AIBRAHIM39', '037400']);
  });

  it('does not repeat an identifier when both forms are the same', async () => {
    const { service, getMyRequests } = make();

    await service.myRequests(
      { username: '037400', employeeNumber: '037400', roles: [Role.EMPLOYEE] } as AuthenticatedUser,
      'en',
    );

    expect(getMyRequests).toHaveBeenCalledWith(['037400'], 'en');
  });

  /**
   * op 20 is an APPROVER inbox (both its views filter on the approver side),
   * and it is open to any employee for the same reason op 23 is — the role
   * gate was a permanent 403. So it needs the same protection: an employee who
   * approves nothing gets an empty list, and cannot ask for someone else's.
   */
  it('scopes the approval inbox to the caller too', async () => {
    const { service, getSummary } = make();

    await service.summary(CALLER, 'en');

    expect(getSummary).toHaveBeenCalledWith(['AIBRAHIM39', '037400'], 'en');
  });
});
