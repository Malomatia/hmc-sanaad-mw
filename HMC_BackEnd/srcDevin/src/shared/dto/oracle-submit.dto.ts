import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

type DtoClass = { prototype: object };

export function defineOptionalStringFields(
  target: DtoClass,
  fields: readonly string[],
  examples: Readonly<Record<string, string>> = {},
): void {
  for (const field of fields) {
    ApiPropertyOptional({ type: String, example: examples[field] })(target.prototype, field);
    IsOptional()(target.prototype, field);
    IsString()(target.prototype, field);
  }
}

/**
 * Optional `p_*` fields bound to a PL/SQL associative array (e.g.
 * `XXHMC_SND_ADD_DEPENDENT_PKG.my_type`, a `TABLE OF VARCHAR2 INDEX BY
 * BINARY_INTEGER`): the wire value is an array of strings
 * (`"p_phone_type": ["type1", "type2"]`). Tolerated and normalized:
 *  - a lone string/number is wrapped into a one-item array (backward compat);
 *  - numeric items are coerced to strings (`"p_phone_id": [324324]` — the
 *    collection element type is VARCHAR2, cf. the pkg sample `p_ph_type(1) := '1234'`).
 */
export function defineOptionalStringArrayFields(
  target: DtoClass,
  fields: readonly string[],
  examples: Readonly<Record<string, readonly string[]>> = {},
): void {
  for (const field of fields) {
    ApiPropertyOptional({ type: [String], example: examples[field] })(target.prototype, field);
    IsOptional()(target.prototype, field);
    Transform(({ value }) => {
      if (typeof value === 'string' || typeof value === 'number') return [String(value)];
      if (Array.isArray(value)) {
        return value.map((item) => (typeof item === 'number' ? String(item) : item));
      }
      return value;
    })(target.prototype, field);
    IsArray()(target.prototype, field);
    IsString({ each: true })(target.prototype, field);
  }
}

/**
 * Required `p_*` field of an Oracle submit body. `description` is worth filling
 * in whenever the accepted values are not obvious from the example — the value
 * sets behind these procedures are not discoverable from the schema, and a
 * wrong one usually comes back as a bare ORA-20001 / ORA-01403.
 */
export function RequiredString(example?: string, description?: string): PropertyDecorator {
  return (target, propertyKey) => {
    ApiProperty({ type: String, example, description })(target, propertyKey as string);
    IsString()(target, propertyKey as string);
    IsNotEmpty()(target, propertyKey as string);
  };
}

export const ATTACHMENT_FIELDS = Array.from({ length: 10 }, (_, index) => index + 1).flatMap(
  (index) => [`p_file_name${index}`, `p_attachment${index}`],
);
