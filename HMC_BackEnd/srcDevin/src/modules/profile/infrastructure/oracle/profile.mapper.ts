import { Lang } from '@shared/domain/lang';
import { dateStr, str, strAr, pruneUndefined } from '@shared/utils/mapper.util';
import {
  DependentAddress,
  DependentPhone,
  EmployeeAddress,
  EmployeeDependent,
  EmployeePhone,
  EmployeeProfile,
  PersonalDetails,
} from '../../domain/entities/employee-profile';

export interface ProfileRowSet {
  personalRows: Record<string, any>[];
  phoneRows: Record<string, any>[];
  addressRows: Record<string, any>[];
  insideAddressRows: Record<string, any>[];
  dependentPhoneRows: Record<string, any>[];
  dependentAddressRows: Record<string, any>[];
  dependentRows: Record<string, any>[];
}

/** Oracle row → profile domain (Anticorruption Layer; decodes Arabic). */
export class ProfileMapper {
  static toPersonal(row: Record<string, any> | undefined, _lang: Lang): PersonalDetails {
    if (!row) return {};
    return pruneUndefined<PersonalDetails>({
      username: str(row, 'user_name') ?? str(row, 'username'),
      employeeNumber: str(row, 'employee_number') ?? str(row, 'employeenumber'),
      joiningDate: dateStr(row, 'joining_date') ?? dateStr(row, 'joiningdate'),
      emailAddress: str(row, 'email_address') ?? str(row, 'emailaddress'),
      fullName: str(row, 'full_name') ?? str(row, 'fullname'),
      firstName: str(row, 'first_name') ?? str(row, 'firstname'),
      middleNames: str(row, 'middle_names') ?? str(row, 'middlenames'),
      lastName: str(row, 'last_name') ?? str(row, 'lastname'),
      dateOfBirth: dateStr(row, 'date_of_birth') ?? dateStr(row, 'dateofbirth'),
      qidNumber: str(row, 'qid_number') ?? str(row, 'qidnumber'),
      gender: str(row, 'gender'),
      maritalStatus: str(row, 'marital_status') ?? str(row, 'maritalstatus'),
      fullNameAr: strAr(row, 'full_name_ar') ?? strAr(row, 'fullnamear'),
      genderAr: strAr(row, 'gender_ar') ?? strAr(row, 'genderar'),
      maritalStatusAr: strAr(row, 'marital_status_ar') ?? strAr(row, 'maritalstatusar'),
    });
  }

  static toPhone(row: Record<string, any>): EmployeePhone {
    return pruneUndefined<EmployeePhone>({
      phoneId: str(row, 'phone_id') ?? str(row, 'phoneid'),
      username: str(row, 'user_name') ?? str(row, 'username'),
      employeeNumber: str(row, 'employee_number') ?? str(row, 'employeenumber'),
      phoneType: str(row, 'phone_type') ?? str(row, 'phonetype'),
      phoneTypeAr: strAr(row, 'phone_type_ar') ?? strAr(row, 'phonetypear'),
      phoneNumber: str(row, 'phone_number') ?? str(row, 'phonenumber'),
      dependentId: str(row, 'dependent_id') ?? str(row, 'dependentid'),
    });
  }

  static toAddress(row: Record<string, any>): EmployeeAddress {
    return pruneUndefined<EmployeeAddress>({
      addressId: str(row, 'address_id') ?? str(row, 'addressid'),
      username: str(row, 'user_name') ?? str(row, 'username'),
      employeeNumber: str(row, 'employee_number') ?? str(row, 'employeenumber'),
      addressLine1: str(row, 'address_line1') ?? str(row, 'addressline1'),
      addressLine2: str(row, 'address_line2') ?? str(row, 'addressline2'),
      addressLine3: str(row, 'address_line3') ?? str(row, 'addressline3'),
      addressType: str(row, 'address_type') ?? str(row, 'addresstype'),
      addressTypeAr: strAr(row, 'address_type_ar') ?? strAr(row, 'addresstypear'),
      country: str(row, 'country'),
      townOrCity: str(row, 'town_or_city') ?? str(row, 'townorcity'),
      region1: str(row, 'region_1') ?? str(row, 'region1'),
      region2: str(row, 'region_2') ?? str(row, 'region2'),
      region3: str(row, 'region_3') ?? str(row, 'region3'),
      postalCode: str(row, 'postal_code') ?? str(row, 'postalcode'),
      countryMeaning: str(row, 'country_meaning') ?? str(row, 'countrymeaning'),
      style: str(row, 'style'),
    });
  }

  /**
   * XXHMC_SND_DEP_PHONE_V row → dependent phone. The view's columns differ
   * from EMP_PHONE_V (TYPE / MOBILE_PHONE / TYPE_CODE instead of PHONE_TYPE /
   * PHONE_NUMBER), so it gets its own mapper covering all 6 columns.
   */
  static toDependentPhone(row: Record<string, any>): DependentPhone {
    return pruneUndefined<DependentPhone>({
      phoneId: str(row, 'phone_id'),
      dependentId: str(row, 'dependent_id'),
      phoneType: str(row, 'type'),
      phoneTypeAr: strAr(row, 'phone_type_ar'),
      typeCode: str(row, 'type_code'),
      phoneNumber: str(row, 'mobile_phone'),
    });
  }

  /** XXHMC_SND_DEP_ADDRESS_V row → dependent address (all 13 columns). */
  static toDependentAddress(row: Record<string, any>): DependentAddress {
    return pruneUndefined<DependentAddress>({
      addressId: str(row, 'address_id'),
      addressLine1: str(row, 'address_line1'),
      addressLine2: str(row, 'address_line2'),
      addressLine3: str(row, 'address_line3'),
      addressType: str(row, 'type'),
      addressTypeAr: strAr(row, 'address_type_ar'),
      typeCode: str(row, 'type_code'),
      country: str(row, 'country'),
      townOrCity: str(row, 'town_or_city'),
      region1: str(row, 'region_1'),
      region2: str(row, 'region_2'),
      region3: str(row, 'region_3'),
      postalCode: str(row, 'postal_code'),
    });
  }

  /** XXHMC_SND_EMP_CONTACT_V row → dependent (identity + QID/passport/visa + address). */
  static toDependent(row: Record<string, any>): EmployeeDependent {
    return pruneUndefined<EmployeeDependent>({
      dependentId: str(row, 'dependent_id'),
      username: str(row, 'user_name') ?? str(row, 'username'),
      employeeNumber: str(row, 'employee_number'),
      firstName: str(row, 'first_name'),
      middleName: str(row, 'middle_name'),
      lastName: str(row, 'last_name'),
      title: str(row, 'title'),
      emailAddress: str(row, 'email_address'),
      suffix: str(row, 'suffix'),
      prefix: str(row, 'preffix'), // view column is spelled PREFFIX
      dateOfBirth: dateStr(row, 'date_of_birth'),
      gender: str(row, 'gender'),
      genderAr: strAr(row, 'gender_ar'),
      qidNumber: str(row, 'qid_number'),
      contactType: str(row, 'contact_type'),
      contactTypeAr: strAr(row, 'contact_type_ar'),
      relationshipStartDate: dateStr(row, 'relationship_start_date'),
      passportNumber: str(row, 'passport_number'),
      dateOfIssue: dateStr(row, 'date_of_issue'),
      dateOfExpiry: dateStr(row, 'date_of_expiry'),
      placeOfIssue: str(row, 'place_of_issue'),
      countryOfIssue: str(row, 'country_of_issue'),
      countryOfIssueCode: str(row, 'country_of_issue_code'),
      visaType: str(row, 'visa_type'),
      visaNumber: str(row, 'visa_number'),
      dateOfIssueOfVisa: dateStr(row, 'date_of_issue_of_visa'),
      expiryDateOfVisa: dateStr(row, 'expiry_date_of_visa'),
      visaValidity: str(row, 'visa_validity'),
      idNumber: str(row, 'id_number'),
      expiryDate: dateStr(row, 'expiry_date'),
      dateOfIssueQid: dateStr(row, 'date_of_issue_qid'),
      jobAsInQid: str(row, 'job_as_in_qid'),
      typeOfSponsorship: str(row, 'type_of_sponsorship'),
      typeOfSponsorshipAr: strAr(row, 'type_of_sponsorship_ar'),
      nameOfContactSponsor: str(row, 'name_of_contact_sponsor'),
      ifOthersNameOfSponsor: str(row, 'if_others_name_of_sponsor'),
      addressId: str(row, 'address_id'),
      addressLine1: str(row, 'address_line1'),
      addressLine2: str(row, 'address_line2'),
      addressLine3: str(row, 'address_line3'),
      addressType: str(row, 'type'), // address type; Arabic twin is ADDRESS_TYPE_AR
      addressTypeAr: strAr(row, 'address_type_ar'),
      country: str(row, 'country'),
      townOrCity: str(row, 'town_or_city'),
      region1: str(row, 'region_1'),
      region2: str(row, 'region_2'),
      region3: str(row, 'region_3'),
      postalCode: str(row, 'postal_code'),
      contactTypeId: str(row, 'contact_type_id'),
      relationshipId: str(row, 'relation_ship_id'), // view column is RELATION_SHIP_ID
      depStatus: str(row, 'dep_status'),
      employmentStatus: str(row, 'employment_status'),
      employmentStatusAr: strAr(row, 'employment_status_ar'),
      comments: str(row, 'comments'),
    });
  }

  static toProfile(rows: ProfileRowSet, lang: Lang): EmployeeProfile {
    return {
      personal: this.toPersonal(rows.personalRows[0], lang),
      phones: rows.phoneRows.map((r) => this.toPhone(r)),
      outsideAddresses: rows.addressRows.map((r) => this.toAddress(r)),
      insideAddresses: rows.insideAddressRows.map((r) => this.toAddress(r)),
      dependentPhones: rows.dependentPhoneRows.map((r) => this.toDependentPhone(r)),
      dependentAddresses: rows.dependentAddressRows.map((r) => this.toDependentAddress(r)),
      dependents: rows.dependentRows.map((r) => this.toDependent(r)),
    };
  }
}
