import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import {
  ATTACHMENT_FIELDS,
  defineOptionalStringArrayFields,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/**
 * op 64 — dependent LOV query. `DEP_LOOKUP_LOV` mixes SIX vocabularies in one
 * view, selected with `data_type`. This is the ONLY source for several values
 * the submit endpoints validate, including the address types used by the
 * CONTACT module (there is no separate address-type endpoint). Verified live
 * 2026-08-25:
 *
 * | `data_type`    | Values (`code` → `meaning`) |
 * |----------------|-----------------------------|
 * | `CONTACT`      | `BROTHER`→Brother, `C`→Child, `P`→Parent, `SISTER`→Sister, `S`→Spouse |
 * | `ADDRESS_TYPE` | HMC Accommodation Address, Primary Home Country Address, Primary Local Address, Recruiting, Temporary Offer Address |
 * | `SPONSORSHIP`  | Employee, HMC, Others, Spouse |
 * | `VISA`         | QID(Qatari), Residence Permit |
 * | `TITLE`        | Dr., Miss, Mr., Mrs., Ms., Professor |
 * | `GENDER`       | Male, Female |
 *
 * NOTE the CONTACT group is the only one with a real `code`, and the two
 * dependent procedures disagree on which half to send: op 31 delete needs the
 * CODE (`C`), op 24 update needs the MEANING (`Child`). Values outside this
 * list — `Son`, `Daughter`, `Contact`, `Work Location Address` — do not exist
 * and are rejected with ORA-20001.
 */
export class DependentLovQueryDto extends LangQueryDto {
  @ApiPropertyOptional({
    example: 'CONTACT',
    description:
      'Filter on the grouping column (Oracle D_DATA_TYPE): CONTACT | ADDRESS_TYPE | SPONSORSHIP | VISA | TITLE | GENDER. Omit it to get the full mixed list.',
  })
  @IsOptional()
  @IsString()
  data_type?: string;
}

const IDENTITY_FIELDS = [
  'p_title',
  'p_middle_name',
  'p_suffix',
  'p_prefix',
  'p_email_address',
  'p_relationship_start_date',
  'p_national_identifier',
  'p_passport_number',
  'p_pp_issue_date',
  'p_pp_expiry_date',
  'p_place_of_issue',
  'p_country_of_issue',
  'p_visa_type',
  'p_visa_number',
  'p_visa_issue_date',
  'p_visa_expiry_date',
  'p_visa_validity',
  'p_id_number',
  'p_id_expiry_date',
  'p_id_issue_date',
  'p_job_as_in_qid',
  'p_type_of_sponsorship',
  'p_sponsor_contact_name',
  'p_other_sponsor',
] as const;

const ADDRESS_FIELDS = [
  'p_main_address',
  'p_primary_flag',
  'p_address_type',
  'p_country',
  'p_address_line1',
  'p_address_line2',
  'p_address_line3',
  'p_city',
  'p_town_or_city',
  'p_region_1',
  'p_region_2',
  'p_region_3',
  'p_region1',
  'p_region2',
  'p_region3',
  'p_po_box',
] as const;

/**
 * op 65 — ADD_DEPENDENT_PR. The Oracle flexfield enforces more than the DTO's
 * required fields (verified live 2026-08-23, successflag S with the pinned
 * example set): at least one attachment ("Attachement is mandatory"),
 * `p_passport_number`, `p_pp_expiry_date`, `p_country_of_issue`,
 * `p_visa_type` (op 64 VISA group: 'QID(Qatari)' | 'Residence Permit'),
 * `p_visa_validity` = Yes|No, and a UNIQUE `p_id_number` (QID — duplicates
 * return "This QID already exists."). `p_relationship` must be an op 64
 * CONTACT value ('Child', 'Spouse', ... — not "Son").
 */
export class AddDependentRequestDto {
  @RequiredString('Testchild3')
  p_first_name!: string;

  @RequiredString('Ibrahim')
  p_last_name!: string;

  @RequiredString('Child')
  p_relationship!: string;

  @RequiredString('Male')
  p_gender!: string;

  @RequiredString('20150101')
  p_date_of_birth!: string;

  [key: string]: unknown;
}

// p_phone_type / p_phone_number are PL/SQL associative arrays on the Oracle
// side (XXHMC_SND_ADD_DEPENDENT_PKG.my_type, paired by index:
// p_phone_type[i] types p_phone_number[i]) — send arrays of strings.
defineOptionalStringArrayFields(
  AddDependentRequestDto,
  ['p_phone_type', 'p_phone_number'],
  {
    p_phone_type: ['Qatar Mobile Number', 'Home'],
    p_phone_number: ['55512345', '44412345'],
  },
);

defineOptionalStringFields(
  AddDependentRequestDto,
  [
    ...IDENTITY_FIELDS,
    'p_phone_enabled',
    ...ADDRESS_FIELDS,
    'p_employment_status',
    'p_comments',
    ...ATTACHMENT_FIELDS,
  ],
  {
    p_title: 'Mr.',
    p_relationship_start_date: '20150101',
    p_email_address: 'testchild3@example.com',
    p_passport_number: 'A7654323',
    p_pp_issue_date: '20200101',
    p_pp_expiry_date: '20300101',
    p_place_of_issue: 'Doha',
    p_country_of_issue: 'QA',
    p_visa_type: 'Residence Permit',
    p_visa_number: '123456791',
    p_visa_issue_date: '20250101',
    p_visa_expiry_date: '20270101',
    p_visa_validity: 'Yes',
    p_id_number: '31599876544',
    p_id_issue_date: '20250101',
    p_id_expiry_date: '20270101',
    p_job_as_in_qid: 'Student',
    p_type_of_sponsorship: 'Employee',
    p_sponsor_contact_name: 'Amir Ibrahim',
    p_file_name1: 'birth-certificate.pdf',
    p_attachment1: 'dGVzdCBhdHRhY2htZW50',
  },
);

/**
 * op 24 — UPDATE_DEPENDENT_PR. Verified live (2026-08-23): like the add, the
 * procedure REQUIRES at least one attachment ("Attachement is mandatory").
 * The caller's dependent ids are visible in GET /profile
 * (dependentPhones/dependentAddresses).
 */
/**
 * op 24 — UPDATE_DEPENDENT_PR. Verified end-to-end on 2026-08-24
 * (successflag Y, dependent 329302). The procedure re-validates the WHOLE
 * dependent flexfield, so a partial update is rejected — send the full
 * identity/passport/visa set even when changing one field:
 *
 *  - `p_relation_ship` takes the **MEANING** here (`Child`) — the opposite of
 *    op 31 delete, which needs the CODE (`C`). Omitting it makes the procedure
 *    update PER_CONTACT_RELATIONSHIPS.CONTACT_TYPE to NULL → ORA-01407, and a
 *    code (`C`) resolves to NULL the same way.
 *  - `p_type_of_sponsership` must exist in the HMC_HR_SPONSORSHIP_PERSON value
 *    set: `Employee` works, relationship words like `Father` raise
 *    ORA-20001 FLEX-VALUE DOES NOT EXIST.
 *  - Passport number + its issue/expiry dates, QID + expiry, visa type/number/
 *    dates and `p_visa_validy` (Yes|No) are all required segments
 *    (FLEX-NULL REQUIRED SEGMENT otherwise), and >= 1 attachment is mandatory.
 */
export class UpdateDependentRequestDto {
  @RequiredString('329302')
  p_dependent_id!: string;

  [key: string]: unknown;
}

// Like the add, the phone fields are PL/SQL associative arrays paired by
// index (XXHMC_SND_ADD_DEPENDENT_PKG.my_type): p_phone_id[i] identifies the
// phone that p_phone_type[i]/p_phone_number[i] update; the `*1` set is the
// second phone group of the legacy service, same array shape.
defineOptionalStringArrayFields(
  UpdateDependentRequestDto,
  ['p_phone_id', 'p_phone_type', 'p_phone_number', 'p_phone_id1', 'p_phone_type1', 'p_phone_number1'],
  {
    p_phone_id: ['324324', '4324234'],
    p_phone_type: ['Qatar Mobile Number', 'Home'],
    p_phone_number: ['55512345', '44412345'],
  },
);

defineOptionalStringFields(
  UpdateDependentRequestDto,
  [
  'p_title',
  'p_first_name',
  'p_middle_name',
  'p_last_name',
  'p_suffix',
  'p_prefix',
  'p_email_address',
  'p_relationship',
  'p_relation_ship',
  'p_relationship_start_date',
  'p_relation_ship_start_date',
  'p_passport_number',
  'p_date_of_issue',
  'p_date_of_expire',
  'p_place_of_issue',
  'p_country_of_issue',
  'p_visa_type',
  'p_visa_number',
  'p_date_of_issue_visa',
  'p_date_of_expire_visa',
  'p_visa_validity',
  'p_visa_validy',
  'p_id_number',
  'p_expiry_date',
  'p_date_of_issue_qid',
  'p_date_of_issuue_qid',
  // NOTE the value set: HMC_HR_SPONSORSHIP_PERSON accepts 'Employee' (verified),
  // NOT relationship words like 'Father'.
  'p_type_of_sponsorship',
  'p_type_of_sponsership',
  'p_name_of_contact',
  'p_name_of_sponsor',
  'p_gender',
  'p_gendar',
  'p_qid_number',
  'p_date_of_birth',
  'p_address_id',
  ...ADDRESS_FIELDS,
  'p_phone_enabled',
  'p_phone_enabled1',
  'p_employment_status',
  'p_comments',
  ...ATTACHMENT_FIELDS,
  ],
  // The complete payload that returned successflag Y on 2026-08-24 — copy it
  // as-is from Swagger and it works (the procedure re-validates every segment,
  // so a shorter body is rejected).
  {
    p_relation_ship: 'Child',
    p_relation_ship_start_date: '20100923',
    p_title: 'Mr',
    p_first_name: 'Jerome',
    p_last_name: 'Ibrahim',
    p_gendar: 'Male',
    p_date_of_birth: '20100923',
    p_id_number: '28812345678',
    p_expiry_date: '20301231',
    p_date_of_issue_qid: '20200101',
    p_passport_number: 'A38697134',
    p_date_of_issue: '20200101',
    p_date_of_expire: '20301231',
    p_place_of_issue: 'Doha',
    p_country_of_issue: 'QA',
    p_visa_type: 'Residence Permit',
    p_visa_number: '123456789',
    p_date_of_issue_visa: '20200101',
    p_date_of_expire_visa: '20301231',
    p_visa_validy: 'Yes',
    p_type_of_sponsership: 'Employee',
    p_name_of_sponsor: 'Amir Sami Samir Ibrahim',
    p_file_name1: 'update-proof.pdf',
    p_attachment1: 'dGVzdCBhdHRhY2htZW50',
  },
);

/**
 * op 31 — REMOVE_DEPENDENT_PR. Verified end-to-end on 2026-08-24
 * (successflag Y) with dependent id 1607679.
 *
 * `p_relationship` must be the LOV **CODE**, not the meaning: the procedure
 * forwards it straight to the HR API as the contact type —
 *   hr_contact_rel_api.update_contact_relationship(p_contact_type => p_relation_ship …)
 *                                                                  (source line 253)
 * so `C` (Child) works while `Child` raises ORA-20001 "The Contact Type you
 * have entered for this Contact Relationship does not exist". Omitting it
 * entirely raises ORA-01407 (CONTACT_TYPE set to NULL). Codes come from the
 * op 64 LOV, CONTACT group: C, S, P, BROTHER, SISTER.
 * At least one attachment is mandatory.
 */
export class DeleteDependentRequestDto {
  @RequiredString(
    '1607679',
    'An existing dependent id of the caller. Send `p_relationship` as the LOV CODE ' +
      '(GET /dependents/lov?data_type=CONTACT → C | S | P | BROTHER | SISTER) — the ' +
      'meaning ("Child") is rejected here, unlike op 24 update which needs the meaning.',
  )
  p_dependent_id!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  DeleteDependentRequestDto,
  [
    'p_relation_ship_end_date',
    'p_relationship_end_date',
    'p_contact_type',
    'p_relation_ship',
    'p_relationship',
    ...ATTACHMENT_FIELDS,
  ],
  {
    p_relationship: 'C',
    p_relationship_end_date: '20260824',
    p_file_name1: 'end-proof.pdf',
    p_attachment1: 'dGVzdCBhdHRhY2htZW50',
  },
);

export class PassportApplyRequestDto {
  @RequiredString('A498989')
  p_passport_number!: string;

  @RequiredString('20260121')
  p_date_of_issue!: string;

  @RequiredString('20360121')
  p_date_of_expiry!: string;

  @RequiredString('Normal')
  p_type_of_passport!: string;

  @RequiredString('Doha')
  p_place_of_issue!: string;

  @RequiredString('QA')
  p_country_of_issue!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(PassportApplyRequestDto, ATTACHMENT_FIELDS);
