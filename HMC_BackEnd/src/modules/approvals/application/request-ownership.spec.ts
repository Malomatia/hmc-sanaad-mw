import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsRepository } from '../domain/approvals.repository';
import { AuthenticatedUser, Role } from '@core/auth/auth-user.interface';
import { ConfigService } from '@nestjs/config';

/** A non-production environment, where an explicit ?enum= is honoured. */
const nonProduction = () =>
  ({ getOrThrow: () => ({ nodeEnv: 'development' }) }) as unknown as ConfigService;

/**
 * op 21 and the attachment download resolve a request by ID ALONE — no caller
 * appears in either query — and the notification ids run in sequence
 * (123859430, 123859432, 123859449…). The approver role was the only thing
 * keeping an employee from walking that range and reading every request in the
 * organisation: salary certificates, QIDs, sick-leave reasons, uploaded
 * documents.
 *
 * Both routes are now open (an employee has to be able to open their own
 * request), so these checks are what stand in for the gate. They are the
 * security boundary, not a convenience.
 */
describe('request ownership', () => {
  const CALLER: AuthenticatedUser = {
    username: 'AIBRAHIM39',
    employeeNumber: '037400',
    roles: [Role.EMPLOYEE],
  } as AuthenticatedUser;

  function make(over: Partial<jest.Mocked<ApprovalsRepository>> = {}) {
    const repo = {
      isOwnedBy: jest.fn().mockResolvedValue(true),
      isItemOwnedBy: jest.fn().mockResolvedValue(true),
      itemKeyOfAttachment: jest.fn().mockResolvedValue('18876168'),
      getDetails: jest.fn().mockResolvedValue({
        header: {}, serviceView: null, itemKey: null, detailRow: undefined, attachments: [],
      }),
      getAttachmentContent: jest.fn().mockResolvedValue({
        fileName: 'x.pdf', contentType: 'application/pdf', contentBase64: 'AA==',
      }),
      ...over,
    } as unknown as ApprovalsRepository;
    return { service: new ApprovalsService(repo, nonProduction()), repo };
  }

  describe('op 21 details', () => {
    it('is refused when the request is not the calleretc', async () => {
      const { service, repo } = make({ isOwnedBy: jest.fn().mockResolvedValue(false) });

      await expect(service.details('123859447', 'en', CALLER)).rejects.toThrow(ForbiddenException);
      expect(repo.getDetails).not.toHaveBeenCalled();
    });

    it('checks ownership BEFORE reading anything', async () => {
      const order: string[] = [];
      const { service } = make({
        isOwnedBy: jest.fn().mockImplementation(async () => {
          order.push('check');
          return true;
        }),
        getDetails: jest.fn().mockImplementation(async () => {
          order.push('read');
          return { header: {}, serviceView: null, itemKey: null, detailRow: undefined, attachments: [] };
        }),
      });

      await service.details('123859447', 'en', CALLER);

      expect(order).toEqual(['check', 'read']);
    });

    it('asks with the caller from the token, not the route', async () => {
      const { service, repo } = make();

      await service.details('123859447', 'en', CALLER);

      expect(repo.isOwnedBy).toHaveBeenCalledWith('123859447', ['AIBRAHIM39', '037400']);
    });

    it('goes through for a request the caller owns', async () => {
      const { service } = make();

      await expect(service.details('123859449', 'en', CALLER)).resolves.toBeDefined();
    });
  });

  describe('attachment download', () => {
    it('is refused when the file belongs to someone else request', async () => {
      const { service, repo } = make({ isItemOwnedBy: jest.fn().mockResolvedValue(false) });

      await expect(service.attachment('9911', CALLER)).rejects.toThrow(ForbiddenException);
      expect(repo.getAttachmentContent).not.toHaveBeenCalled();
    });

    it('is refused when the file belongs to no resolvable request', async () => {
      const { service, repo } = make({ itemKeyOfAttachment: jest.fn().mockResolvedValue(undefined) });

      await expect(service.attachment('9911', CALLER)).rejects.toThrow(ForbiddenException);
      expect(repo.getAttachmentContent).not.toHaveBeenCalled();
    });

    it('serves a file from the caller own request', async () => {
      const { service } = make();

      await expect(service.attachment('9911', CALLER)).resolves.toMatchObject({ fileName: 'x.pdf' });
    });

    it('still answers 404 for an id that owns nothing', async () => {
      const { service } = make({ getAttachmentContent: jest.fn().mockResolvedValue(undefined) });

      await expect(service.attachment('9911', CALLER)).rejects.toThrow(NotFoundException);
    });
  });
});
