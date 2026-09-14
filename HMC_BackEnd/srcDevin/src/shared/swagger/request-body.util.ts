/** A minimal OpenAPI schema fragment (kept local to avoid a deep import path). */
type SchemaFragment = Record<string, unknown>;

/**
 * The submit procedures (UPD_PERSONAL_INFO_PR, SUPERVISOR_PR, HR_LEAV_*_PR, ...)
 * share ten optional attachment slots: `p_file_name1..10` + `p_attachment1..10`.
 * These helpers keep the Swagger request-body schemas DRY and consistent — the
 * field names match exactly what the backend binds (`pick()` also accepts the
 * bare `file_name1` form). Attachment content is a base64-encoded string.
 */
export function attachmentProperties(slots = 10): Record<string, SchemaFragment> {
  const props: Record<string, SchemaFragment> = {};
  for (let i = 1; i <= slots; i++) {
    props[`p_file_name${i}`] = {
      type: 'string',
      description: `File name for attachment slot ${i} (optional).`,
    };
    props[`p_attachment${i}`] = {
      type: 'string',
      format: 'byte',
      description: `Base64-encoded content for attachment slot ${i} (optional).`,
    };
  }
  return props;
}

/** Example values for the first attachment slot (the rest follow the same pattern). */
export const ATTACHMENT_EXAMPLE = {
  p_file_name1: 'passport.pdf',
  p_attachment1: 'JVBERi0xLjQKJ...==',
};

/** All ten attachment slots as `null` — for request bodies whose Swagger example should show every slot explicitly unset. */
export function nullAttachmentExample(slots = 10): Record<string, null> {
  const example: Record<string, null> = {};
  for (let i = 1; i <= slots; i++) {
    example[`p_file_name${i}`] = null;
    example[`p_attachment${i}`] = null;
  }
  return example;
}
