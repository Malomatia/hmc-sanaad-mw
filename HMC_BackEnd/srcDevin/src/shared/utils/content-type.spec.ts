import { resolveContentType, sniffContentType } from './content-type.util';

const bytes = (hex: string, pad = 16) =>
  Buffer.concat([Buffer.from(hex, 'hex'), Buffer.alloc(pad)]);

const JPEG = bytes('FFD8FFE000104A464946');
const PNG = bytes('89504E470D0A1A0A');
const PDF = bytes('255044462D312E34');
const DOCX = bytes('504B03041400'); // also .xlsx, also a bare .zip
const DOC = bytes('D0CF11E0A1B11AE1'); // also .xls

/**
 * 48 attachments in HR_ATTACHMENTS_V are stored as `application/pdf` while the
 * file is a JPEG or PNG - 27% of everything typed as PDF, measured 2026-09-06.
 * A client handed `application/pdf` for a JPEG opens a PDF viewer and fails.
 *
 * These pin the rule that fixes it without trusting the column: the file's own
 * bytes decide, except where a container is shared by several formats and only
 * the stored value can tell them apart.
 */
describe('resolving an attachment content type', () => {
  it('calls a JPEG a JPEG even though the row says PDF', () => {
    expect(
      resolveContentType({
        bytes: JPEG,
        fileName: 'IMG-20260830-WA0005.jpg',
        stored: 'application/pdf',
      }),
    ).toBe('image/jpeg');
  });

  it('calls a PNG a PNG even though the row says PDF', () => {
    expect(resolveContentType({ bytes: PNG, fileName: 'scan.png', stored: 'application/pdf' })).toBe(
      'image/png',
    );
  });

  it('leaves a genuine PDF alone', () => {
    expect(
      resolveContentType({ bytes: PDF, fileName: 'cert.pdf', stored: 'application/pdf' }),
    ).toBe('application/pdf');
  });

  it('believes the bytes over a misleading extension too', () => {
    // The extension is as untrustworthy as the column; a rename is one click.
    expect(resolveContentType({ bytes: JPEG, fileName: 'photo.pdf', stored: null })).toBe(
      'image/jpeg',
    );
  });

  it('keeps the stored type for a ZIP container, which .docx and .xlsx share', () => {
    const stored = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    expect(resolveContentType({ bytes: DOCX, fileName: 'letter.docx', stored })).toBe(stored);
  });

  it('keeps the stored type for an OLE container, which .doc and .xls share', () => {
    expect(
      resolveContentType({ bytes: DOC, fileName: 'old.doc', stored: 'application/msword' }),
    ).toBe('application/msword');
  });

  it('falls back to the extension when there are no bytes to read', () => {
    // The attachment LIST carries metadata only, so this is its whole basis.
    expect(resolveContentType({ fileName: 'IMG-1.jpg', stored: 'application/pdf' })).toBe(
      'image/jpeg',
    );
  });

  it('falls back to the stored type when the extension says nothing', () => {
    expect(resolveContentType({ fileName: 'scan', stored: 'image/tiff' })).toBe('image/tiff');
  });

  it('ends at octet-stream rather than inventing a type', () => {
    expect(resolveContentType({ bytes: bytes('41414141'), fileName: 'x', stored: null })).toBe(
      'application/octet-stream',
    );
  });

  it('does not mistake an empty buffer for a known format', () => {
    expect(sniffContentType(Buffer.alloc(0))).toBeUndefined();
    expect(sniffContentType(undefined)).toBeUndefined();
  });

  it.each([
    ['image/jpeg', JPEG],
    ['image/png', PNG],
    ['application/pdf', PDF],
    ['image/gif', bytes('474946383961')],
    ['image/tiff', bytes('49492A00')],
    ['image/bmp', bytes('424D')],
    ['image/webp', bytes('52494646AABBCCDD57454250')],
  ])('recognises %s from its signature', (expected, buf) => {
    expect(sniffContentType(buf)).toBe(expected);
  });
});
