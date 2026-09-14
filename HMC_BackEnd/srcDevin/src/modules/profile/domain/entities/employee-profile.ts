/**
 * Profile domain entities (framework-free). Fields follow the conceptual ER
 * model in Docs_Ai/Database/README.md. Unknown columns map to undefined and
 * are pruned before serialization.
 */
export interface PersonalDetails {
  username?: string;
  employeeNumber?: string;
  joiningDate?: string;
  emailAddress?: string;
  fullName?: string;
  firstName?: string;
  middleNames?: string;
  lastName?: string;
  dateOfBirth?: string;
  qidNumber?: string;
  gender?: string;
  maritalStatus?: string;
  fullNameAr?: string;
  genderAr?: string;
  maritalStatusAr?: string;
  [extra: string]: unknown;
}

export interface EmployeePhone {
  phoneId?: string;
  username?: string;
  employeeNumber?: string;
  phoneType?: string;
  phoneTypeAr?: string;
  phoneNumber?: string;
  dependentId?: string;
}

export interface EmployeeAddress {
  addressId?: string;
  username?: string;
  employeeNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  addressType?: string;
  addressTypeAr?: string;
  country?: string;
  townOrCity?: string;
  region1?: string;
  region2?: string;
  region3?: string;
  postalCode?: string;
  countryMeaning?: string;
  style?: string;
}

/** One row of XXHMC_SND_DEP_PHONE_V (all 6 view columns). */
export interface DependentPhone {
  phoneId?: string;
  dependentId?: string;
  /** TYPE — display meaning; Arabic twin is PHONE_TYPE_AR. */
  phoneType?: string;
  phoneTypeAr?: string;
  /** TYPE_CODE — the lookup code behind TYPE. */
  typeCode?: string;
  /** MOBILE_PHONE. */
  phoneNumber?: string;
}

/** One row of XXHMC_SND_DEP_ADDRESS_V (all 13 view columns). */
export interface DependentAddress {
  addressId?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  /** TYPE — display meaning; Arabic twin is ADDRESS_TYPE_AR. */
  addressType?: string;
  addressTypeAr?: string;
  /** TYPE_CODE — the lookup code behind TYPE. */
  typeCode?: string;
  country?: string;
  townOrCity?: string;
  region1?: string;
  region2?: string;
  region3?: string;
  postalCode?: string;
}

/** One row of XXHMC_SND_EMP_CONTACT_V — a dependent/contact with identity + address. */
export interface EmployeeDependent {
  dependentId?: string;
  username?: string;
  employeeNumber?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  title?: string;
  emailAddress?: string;
  suffix?: string;
  prefix?: string;
  dateOfBirth?: string;
  gender?: string;
  genderAr?: string;
  qidNumber?: string;
  contactType?: string;
  contactTypeAr?: string;
  relationshipStartDate?: string;
  passportNumber?: string;
  dateOfIssue?: string;
  dateOfExpiry?: string;
  placeOfIssue?: string;
  countryOfIssue?: string;
  countryOfIssueCode?: string;
  visaType?: string;
  visaNumber?: string;
  dateOfIssueOfVisa?: string;
  expiryDateOfVisa?: string;
  visaValidity?: string;
  idNumber?: string;
  expiryDate?: string;
  dateOfIssueQid?: string;
  jobAsInQid?: string;
  typeOfSponsorship?: string;
  typeOfSponsorshipAr?: string;
  nameOfContactSponsor?: string;
  ifOthersNameOfSponsor?: string;
  addressId?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  addressType?: string;
  addressTypeAr?: string;
  country?: string;
  townOrCity?: string;
  region1?: string;
  region2?: string;
  region3?: string;
  postalCode?: string;
  contactTypeId?: string;
  relationshipId?: string;
  depStatus?: string;
  employmentStatus?: string;
  employmentStatusAr?: string;
  comments?: string;
}

export interface EmployeeProfile {
  personal: PersonalDetails;
  phones: EmployeePhone[];
  outsideAddresses: EmployeeAddress[];
  insideAddresses: EmployeeAddress[];
  dependentPhones: DependentPhone[];
  dependentAddresses: DependentAddress[];
  dependents: EmployeeDependent[];
}
