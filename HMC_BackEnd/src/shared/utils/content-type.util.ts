/**
 * What an attachment actually is, as opposed to what the row claims.
 *
 * `FILE_CONTENT_TYPE` in HR_ATTACHMENTS_V cannot be trusted: 48 rows measured
 * on 2026-09-06 are stored as `application/pdf` while the file is a JPEG or
 * PNG — 27% of everything typed as PDF. A client handed `application/pdf` for
 * a JPEG opens a PDF viewer and fails, and correcting the rows would not stop
 * the legacy upload path writing the next one the same way.
 *
 * So the file speaks for itself. Bytes first, filename second, the stored
 * value last — and only where each is actually reliable:
 *
 *  - a magic number is conclusive, so it wins outright;
 *  - formats that share a container are NOT guessed from bytes. A .docx and a
 *    .xlsx are both ZIP archives and a .doc and a .xls are both OLE, so those
 *    signatures only tell us the stored value is plausible, never which one it
 *    is;
 *  - with nothing recognisable, the extension is a hint and the stored value
 *    is the fallback.
 */

/** Signatures that identify a format outright, longest prefix checked first. */
const MAGIC: ReadonlyArray<{ hex: string; type: string }> = [
  { hex: '89504E470D0A1A0A', type: 'image/png' },
  { hex: '474946383961', type: 'image/gif' },
  { hex: '474946383761', type: 'image/gif' },
  { hex: '25504446', type: 'application/pdf' }, // %PDF
  { hex: '49492A00', type: 'image/tiff' },
  { hex: '4D4D002A', type: 'image/tiff' },
  { hex: 'FFD8FF', type: 'image/jpeg' },
  { hex: '424D', type: 'image/bmp' },
];

/** Containers shared by several formats: they rule types out, not in. */
const AMBIGUOUS = ['504B0304', 'D0CF11E0A1B11AE1'];

const BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  xml: 'text/xml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const FALLBACK = 'application/octet-stream';

/** WEBP and the other RIFF formats need the four bytes after the size field. */
function riffType(head: string): string | undefined {
  if (!head.startsWith('52494646')) return undefined;
  return head.slice(16, 24) === '57454250' ? 'image/webp' : undefined;
}

/** The format a buffer's own bytes prove, or undefined when they prove nothing. */
export function sniffContentType(bytes: Buffer | undefined): string | undefined {
  if (!bytes?.length) return undefined;
  const head = bytes.subarray(0, 12).toString('hex').toUpperCase();
  return (
    riffType(head) ?? MAGIC.find(({ hex }) => head.startsWith(hex))?.type ?? undefined
  );
}

/** True when the bytes are a container several formats share. */
function isAmbiguous(bytes: Buffer | undefined): boolean {
  if (!bytes?.length) return false;
  const head = bytes.subarray(0, 8).toString('hex').toUpperCase();
  return AMBIGUOUS.some((hex) => head.startsWith(hex));
}

function fromExtension(fileName: string | undefined): string | undefined {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  return ext ? BY_EXTENSION[ext] : undefined;
}

/**
 * The content type to serve. `bytes` is optional because the attachment LIST
 * carries metadata only — there the filename has to stand in for them.
 */
export function resolveContentType(input: {
  bytes?: Buffer;
  fileName?: string;
  stored?: string | null;
}): string {
  const proven = sniffContentType(input.bytes);
  if (proven) return proven;

  const stored = input.stored?.trim();
  // A shared container means the stored value is the only thing that can tell
  // a .docx from a .xlsx, so it is believed here rather than second-guessed.
  if (isAmbiguous(input.bytes) && stored) return stored;

  return fromExtension(input.fileName) ?? stored ?? FALLBACK;
}
