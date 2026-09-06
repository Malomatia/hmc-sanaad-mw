import type { Response } from 'express';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService, WorklistService } from '../application/approvals.service';
import { AuthenticatedUser, Role } from '@core/auth/auth-user.interface';
import { OwnScopeQueryDto } from './dto/approvals.dto';

/**
 * Attachment downloads had never worked, for two independent reasons:
 *
 *  - the URL advertised by `:id/details` omitted the API prefix, so it
 *    answered 404 for anyone who used it as given;
 *  - the route returned the Sanaad JSON envelope with the bytes base64 inside,
 *    which no image view or PDF viewer can render â€” and the bytes were empty
 *    anyway, because Oracle hands back a Lob stream for a BLOB and the reader
 *    tested `Buffer.isBuffer`.
 *
 * It now serves the file itself. These cases pin that.
 */
describe('GET /approvals/attachments/:documentId', () => {
  const CALLER = { username: 'AIBRAHIM39', roles: [Role.EMPLOYEE] } as AuthenticatedUser;
  /** The pipe always supplies lang; these routes ignore it. */
  const QUERY = { lang: 'en' } as OwnScopeQueryDto;

  function make(file: { fileName: string; contentType: string; contentBase64: string }) {
    const approvals = {
      attachment: jest.fn().mockResolvedValue(file),
    } as unknown as jest.Mocked<ApprovalsService>;
    const headers: Record<string, unknown> = {};
    const sent: Buffer[] = [];
    const res = {
      setHeader: (k: string, v: unknown) => {
        headers[k] = v;
      },
      send: (b: Buffer) => sent.push(b),
    } as unknown as Response;
    const controller = new ApprovalsController(approvals, {} as WorklistService);
    return { controller, approvals, headers, sent, res };
  }

  const PDF = {
    fileName: 'marriage-cert.pdf',
    contentType: 'application/pdf',
    contentBase64: Buffer.from('%PDF-1.4 hello').toString('base64'),
  };

  it('sends the decoded bytes, not a base64 string', async () => {
    const { controller, sent, res } = make(PDF);

    await controller.attachment('86443491', QUERY, CALLER, res);

    expect(sent).toHaveLength(1);
    expect(sent[0].toString()).toBe('%PDF-1.4 hello');
  });

  it('declares the stored content type, so a viewer knows what it is', async () => {
    const { controller, headers, res } = make(PDF);

    await controller.attachment('86443491', QUERY, CALLER, res);

    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Length']).toBe(14);
  });

  it('carries the filename, and renders inline rather than forcing a download', async () => {
    const { controller, headers, res } = make(PDF);

    await controller.attachment('86443491', QUERY, CALLER, res);

    expect(headers['Content-Disposition']).toBe('inline; filename="marriage-cert.pdf"');
  });

  it('does not let a quote in the filename break the header', async () => {
    const { controller, headers, res } = make({ ...PDF, fileName: 'my"file".pdf' });

    await controller.attachment('86443491', QUERY, CALLER, res);

    expect(headers['Content-Disposition']).toBe('inline; filename="myfile.pdf"');
  });

  it('serves an image the same way, so it can be shown directly', async () => {
    const { controller, headers, sent, res } = make({
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      contentBase64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
    });

    await controller.attachment('86443595', QUERY, CALLER, res);

    expect(headers['Content-Type']).toBe('image/jpeg');
    expect([...sent[0]]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('still passes the caller through, so the ownership check is not bypassed', async () => {
    const { controller, approvals, res } = make(PDF);

    await controller.attachment('86443491', { ...QUERY, enum: '027303' }, CALLER, res);

    expect(approvals.attachment).toHaveBeenCalledWith('86443491', CALLER, '027303');
  });
});
