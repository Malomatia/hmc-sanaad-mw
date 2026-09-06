import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsRepository } from '../domain/approvals.repository';
import { AuthenticatedUser, Role } from '@core/auth/auth-user.interface';

/**
 * Testers need to point these reads at a real approver to see real rows —
 * nothing in staging grants the approver role and the test employee approves
 * nothing, so without it the whole approver journey reads as empty. A
 * client-supplied `?enum=`/`?username=` does that.
 *
 * In production the same parameter would let any employee read another's
 * requests, and read an approval detail view whose notification ids are
 * SEQUENTIAL. So it is honoured outside production and dropped inside it —
 * the same NODE_ENV rule the SQL consoles use. These cases are that boundary.
 */
describe('acting as another identifier', () => {
  const CALLER: AuthenticatedUser = {
    username: 'AIBRAHIM39',
    employeeNumber: '037400',
    roles: [Role.EMPLOYEE],
  } as AuthenticatedUser;

  const APPROVER = '027303';

  function make(nodeEnv: string) {
    const getSummary = jest.fn().mockResolvedValue({ approvals: [], pendingQid: [] });
    const getMyRequests = jest.fn().mockResolvedValue({ requests: [], pendingQid: [] });
    const isOwnedBy = jest.fn().mockResolvedValue(true);
    const getDetails = jest.fn().mockResolvedValue({
      header: {}, serviceView: null, itemKey: null, detailRow: undefined, attachments: [],
    });
    const repo = {
      getSummary,
      getMyRequests,
      isOwnedBy,
      getDetails,
    } as unknown as ApprovalsRepository;
    const config = { getOrThrow: () => ({ nodeEnv }) } as unknown as ConfigService;
    return { service: new ApprovalsService(repo, config), getSummary, getMyRequests, isOwnedBy };
  }

  describe('outside production', () => {
    it('adds the supplied identifier to the query', async () => {
      const { service, getSummary } = make('development');

      await service.summary(CALLER, 'en', APPROVER);

      expect(getSummary).toHaveBeenCalledWith(['AIBRAHIM39', '037400', APPROVER], 'en');
    });

    it('does the same for my-requests', async () => {
      const { service, getMyRequests } = make('staging');

      await service.myRequests(CALLER, 'en', '053613');

      expect(getMyRequests).toHaveBeenCalledWith(['AIBRAHIM39', '037400', '053613'], 'en');
    });

    it('widens the ownership check, so a tester can open that request', async () => {
      const { service, isOwnedBy } = make('development');

      await service.details('123859447', 'en', CALLER, APPROVER);

      expect(isOwnedBy).toHaveBeenCalledWith('123859447', [
        'AIBRAHIM39',
        '037400',
        APPROVER,
      ]);
    });
  });

  describe('in production', () => {
    it('ignores it — the caller only ever sees their own rows', async () => {
      const { service, getSummary } = make('production');

      await service.summary(CALLER, 'en', APPROVER);

      expect(getSummary).toHaveBeenCalledWith(['AIBRAHIM39', '037400'], 'en');
    });

    it('ignores it on my-requests too', async () => {
      const { service, getMyRequests } = make('production');

      await service.myRequests(CALLER, 'en', '053613');

      expect(getMyRequests).toHaveBeenCalledWith(['AIBRAHIM39', '037400'], 'en');
    });

    it('does not let it widen an ownership check', async () => {
      const { service, isOwnedBy } = make('production');

      await service.details('123859447', 'en', CALLER, APPROVER);

      expect(isOwnedBy).toHaveBeenCalledWith('123859447', ['AIBRAHIM39', '037400']);
    });

    it('so someone else request stays refused', async () => {
      const getSummary = jest.fn();
      const repo = {
        getSummary,
        isOwnedBy: jest.fn().mockResolvedValue(false),
      } as unknown as ApprovalsRepository;
      const config = { getOrThrow: () => ({ nodeEnv: 'production' }) } as unknown as ConfigService;
      const service = new ApprovalsService(repo, config);

      await expect(service.details('123859447', 'en', CALLER, APPROVER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
