import { Role } from '@core/auth/auth-user.interface';
import { EmployeeIdentity, FunctionAccess, FunctionStatus } from '../domain/auth-identity';

/**
 * TESTING ONLY (AUTH_STATIC_LOGIN=true): the fixed /auth/login payload —
 * the real AIBRAHIM39 response captured from the Users DB on 2026-08-26 —
 * returned as-is and embedded in full inside the signed JWT (`userdata`
 * claim), so client testing can proceed with a stable, known dataset while
 * the directory/DB dependencies are being provisioned. Never enable in
 * production.
 */
export const STATIC_LOGIN_IDENTITY: EmployeeIdentity = {
  username: 'AIBRAHIM39',
  employeeName: 'AIBRAHIM39',
  isEmployee: true,
  isNewUser: false,
  roles: [Role.EMPLOYEE],
};

const ENABLED = FunctionStatus.ENABLED;
const COMING_SOON = FunctionStatus.COMING_SOON;

export const STATIC_FUNCTION_ACCESS: FunctionAccess[] = [
  { functionname: 'Request Certificates', functioncode: 'frmRequestCertificates', remarks: 'Request Certificates and Letters', status: ENABLED },
  { functionname: 'School Fees', functioncode: 'frmSchoolFees', remarks: 'School Fees', status: ENABLED },
  { functionname: 'Supervisor Change', functioncode: 'frmSupervisorChange', remarks: 'frmSupervisorChange', status: ENABLED },
  { functionname: 'My Requests', functioncode: 'frmMyRequests', remarks: '', status: ENABLED },
  { functionname: 'Payslip', functioncode: 'frmPayslip', remarks: 'Employee Payslip', status: ENABLED },
  { functionname: 'Housing', functioncode: 'frmHousing', remarks: 'Housing', status: ENABLED },
  { functionname: 'Staffclinic', functioncode: 'frmStaffclinic', remarks: 'Staffclinic', status: ENABLED },
  { functionname: 'Performance', functioncode: 'frmPerformance', remarks: '', status: ENABLED },
  { functionname: 'Sogha', functioncode: 'frmSogha', remarks: '', status: ENABLED },
  { functionname: 'Approvals', functioncode: 'frmApprovals', remarks: 'Approvals', status: ENABLED },
  { functionname: 'LeaveBalances', functioncode: 'frmLeaveBalances', remarks: 'LeaveBalances', status: ENABLED },
  { functionname: 'RequestForLeave', functioncode: 'frmRequestForLeave', remarks: 'Request For Leave', status: ENABLED },
  { functionname: 'Request Leave Amendment', functioncode: 'frmRequestLeaveAmendment', remarks: 'Request Leave Amendment', status: ENABLED },
  { functionname: 'Request Leave Cancellation', functioncode: 'frmRequestLeaveCancellation', remarks: 'Request Leave Cancellation', status: ENABLED },
  { functionname: 'Return From Leave', functioncode: 'frmReturnFromLeave', remarks: 'Return From Leave', status: ENABLED },
  { functionname: 'Employee Profile', functioncode: 'frmProfile', remarks: 'Employee Profile', status: ENABLED },
  { functionname: 'Residence Permit Renewal', functioncode: 'frmResidencePermitRenewal', remarks: 'QID update', status: ENABLED },
  { functionname: 'ID Card', functioncode: 'frmIDCard', remarks: 'HMC ID Card', status: ENABLED },
  { functionname: 'Passport Update', functioncode: 'frmPassport', remarks: 'Passport Update', status: ENABLED },
  { functionname: 'Basic Details', functioncode: 'frmBasicDetails', remarks: 'Employee Basic Details', status: ENABLED },
  { functionname: 'Phone Numbers', functioncode: 'frmPhoneNumbers', remarks: 'Phone Numbers', status: ENABLED },
  { functionname: 'Addressi n Qatar', functioncode: 'frmAddressinQatar', remarks: 'AddressinQatar', status: ENABLED },
  { functionname: 'Address Outside Qatar', functioncode: 'frmAddressOutsideQatar', remarks: 'AddressOutsideQatar', status: ENABLED },
  { functionname: 'Return From Leave.', functioncode: 'frmReturnFromLeave', remarks: '', status: ENABLED },
  { functionname: 'Dependents Update', functioncode: 'frmDependents', remarks: 'Dependents Update', status: ENABLED },
  { functionname: 'Sogha', functioncode: 'frmSogha', remarks: '', status: ENABLED },
  { functionname: 'Employee Details', functioncode: 'MyEmpDetails', remarks: '', status: ENABLED },
  { functionname: 'Flex Banner', functioncode: 'flxbanner', remarks: '', status: ENABLED },
  { functionname: 'frmAnnualTicket', functioncode: 'frmAnnualTicket', remarks: '', status: COMING_SOON },
  { functionname: 'Ticket Cancellation', functioncode: 'frmAnnualTicketCancellation', remarks: '', status: COMING_SOON },
];
