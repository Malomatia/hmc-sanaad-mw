/**
 * Response masking for personally identifying contact data (client request
 * 2026-09-05): the auth journey returns the phone/email so the user can
 * recognise where their OTP went, never the full value. The unmasked values
 * stay internal (OTP delivery, directory lookups).
 */

/** `31141206` → `XXXXX206` (last 3 digits visible; short values fully masked). */
export function maskPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const p = phone.trim();
  if ((p.match(/\d/g)?.length ?? 0) <= 3) return p.replace(/\d/g, 'X');
  return p.replace(/\d(?=(?:\D*\d){3})/g, 'X');
}

/** `MKHOJA@hamad.qa` → `MK****@hamad.qa` (first 2 of the name, domain kept). */
export function maskEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf('@');
  const local = at >= 0 ? email.slice(0, at) : email;
  const domain = at >= 0 ? email.slice(at) : '';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 3))}${domain}`;
}
