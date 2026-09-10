import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AuditContext } from './audit-event';

const FUNCTION_IDS: Readonly<Partial<Record<string, string>>> = {
  auth_login: 'auth_login',
  letters_lov: 'frmRequestCertificates',
  letters_apply: 'frmRequestCertificates',
  schoolFees_apply: 'frmSchoolFees',
  schoolFees_schoolsLov: 'frmSchoolFees',
  schoolFees_termsLov: 'frmSchoolFees',
  schoolFees_eduStageLov: 'frmSchoolFees',
  schoolFees_academicYearLov: 'frmSchoolFees',
  schoolFees_requestTypeLov: 'frmSchoolFees',
  schoolFees_children: 'frmSchoolFees',
  employee_supervisorViews: 'frmSupervisorChange',
  employee_supervisorUpdate: 'frmSupervisorChange',
  approvals_myRequests: 'frmMyRequests',
  payslip_periods: 'frmPayslip',
  payslip_count: 'frmPayslip',
  payslip_generate: 'frmPayslip',
  appointments_upcoming: 'frmStaffclinic',
  appointments_masters: 'frmStaffclinic',
  appointments_bookingInit: 'frmStaffclinic',
  appointments_book: 'frmStaffclinic',
  employee_performance: 'frmPerformance',
  approvals_summary: 'frmApprovals',
  approvals_worklist: 'frmApprovals',
  approvals_worklistSummary: 'frmApprovals',
  approvals_history: 'frmApprovals',
  approvals_details: 'frmApprovals',
  approvals_attachment: 'frmApprovals',
  approvals_decision: 'frmApprovals',
  approvals_requestInfo: 'frmApprovals',
  approvals_reassign: 'frmApprovals',
  lookups_rfmiUser: 'frmApprovals',
  leave_balance: 'frmLeaveBalances',
  leave_apply: 'frmRequestForLeave',
  leave_calculate: 'frmRequestForLeave',
  leave_typesLov: 'frmRequestForLeave',
  leave_reasonsLov: 'frmRequestForLeave',
  leave_classesLov: 'frmRequestForLeave',
  leave_defaults: 'frmRequestForLeave',
  leave_requestLov: 'frmRequestForLeave',
  leave_amend: 'frmRequestLeaveAmendment',
  leave_amendLov: 'frmRequestLeaveAmendment',
  leave_cancel: 'frmRequestLeaveCancellation',
  leave_cancelLov: 'frmRequestLeaveCancellation',
  leave_return: 'frmReturnFromLeave',
  leave_returnLov: 'frmReturnFromLeave',
  leave_returnDetailsLov: 'frmReturnFromLeave',
  leave_relatedLeave1Lov: 'frmReturnFromLeave',
  leave_relatedLeave2Lov: 'frmReturnFromLeave',
  profile_get: 'frmProfile',
  profile_notifications: 'frmNotificationList',
  profile_notificationSummary: 'frmNotificationList',
  profile_notificationHistory: 'frmNotificationList',
  identity_qid: 'frmResidencePermitRenewal',
  identity_qidUpdate: 'frmResidencePermitRenewal',
  identity_idCardApply: 'frmIDCard',
  identity_workLocLov: 'frmIDCard',
  identity_deliveryLov: 'frmIDCard',
  identity_reasonLov: 'frmIDCard',
  dependents_passportTypes: 'frmPassport',
  dependents_passportApply: 'frmPassport',
  dependents_issuePlaceLov: 'frmPassport',
  employee_basic: 'frmBasicDetails',
  profile_updatePersonal: 'frmBasicDetails',
  profile_maritalLov: 'frmBasicDetails',
  contact_phoneTypeLov: 'frmPhoneNumbers',
  contact_upsertPhone: 'frmPhoneNumbers',
  contact_deletePhone: 'frmPhoneNumbers',
  dependents_add: 'frmDependents',
  dependents_update: 'frmDependents',
  dependents_delete: 'frmDependents',
  dependents_lov: 'frmDependents',
  employee_employment: 'MyEmpDetails',
  annualTicket_master: 'frmAnnualTicket',
  annualTicket_apply: 'frmAnnualTicket',
  annualTicket_cancelOptions: 'frmAnnualTicketCancellation',
  annualTicket_cancel: 'frmAnnualTicketCancellation',
};

const ACTION_OVERRIDES = new Map<string, 'view' | 'submit'>([
  ['leave_calculate', 'view'],
  ['auth_healthCheck', 'view'],
  ['appIntegrity_verifyAndroid', 'view'],
  ['diag_oracleSql', 'view'],
  ['diag_usersDbSql', 'view'],
  ['diag_motcSmsDbSql', 'view'],
  ['appIntegrity_challenge', 'submit'],
]);

interface AuditableRequest {
  method: string;
  url: string;
  originalUrl?: string;
  route?: { path?: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  user?: { username?: string; claims?: Record<string, unknown> };
  correlationId?: string;
}

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const resolveFunctionId = (operationId: string, body: Record<string, unknown>): string => {
  const legacyId = operationId.replace(/_v2$/, '');
  if (legacyId === 'contact_createAddress' || legacyId === 'contact_updateAddress') {
    const country = asString(body.p_country)?.trim().toLowerCase();
    if (country) {
      return ['qatar', 'qa'].includes(country) ? 'frmAddressinQatar' : 'frmAddressOutsideQatar';
    }
  }
  return FUNCTION_IDS[operationId] ?? FUNCTION_IDS[legacyId] ?? operationId;
};

const errorCode = (err: unknown): string | undefined => {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; code?: string; name?: string };
    return e.code ?? (e.status != null ? String(e.status) : e.name);
  }
  return undefined;
};

/**
 * Level-1 API-call audit for every request (auth + business), emitted from the
 * backend only. Captures success/failure without altering the response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditableRequest>();
    const res = context.switchToHttp().getResponse<{ statusCode?: number }>();
    const handlerName = `${context.getClass().name}.${context.getHandler().name}`;
    const operation = Reflect.getMetadata(DECORATORS.API_OPERATION, context.getHandler()) as
      { operationId?: string } | undefined;
    const operationId = operation?.operationId ?? handlerName;
    const apiName = `${req.method} ${req.route?.path ?? handlerName}`;
    const body = asRecord(req.body);
    const claims = req.user?.claims ?? {};
    const correlationHeader = req.headers?.['x-correlation-id'];

    const ctx: AuditContext = {
      username: req.user?.username ?? asString(body.username),
      deviceImei:
        asString(claims.deviceImei) ??
        asString(body.imeinumber) ??
        asString(body.deviceimei) ??
        asString(body.deviceid) ??
        asString(body.imei),
      platform: asString(claims.platform) ?? asString(body.platform),
      appName: asString(claims.appName) ?? asString(body.appname) ?? asString(body.appName),
      appVersion:
        asString(claims.appVersion) ?? asString(body.version) ?? asString(body.appVersion),
      functionId: resolveFunctionId(operationId, body),
      actionTaken:
        ACTION_OVERRIDES.get(operationId) ??
        ACTION_OVERRIDES.get(operationId.replace(/_v2$/, '')) ??
        (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase()) ? 'submit' : 'view'),
      source: req.ip,
      correlationId:
        req.correlationId ??
        (Array.isArray(correlationHeader) ? correlationHeader[0] : asString(correlationHeader)),
    };

    return next.handle().pipe(
      tap({
        next: (value) => {
          const data = asRecord(value);
          const status =
            (res.statusCode ?? 200) >= 400 ||
            ['error', 'failed', 'failure'].includes(asString(data.status)?.toLowerCase() ?? '') ||
            data.success === false ||
            (typeof data.successflag === 'string' && data.successflag.toUpperCase() !== 'S')
              ? 'error'
              : 'success';
          const username =
            ctx.functionId === 'auth_login' && status === 'success'
              ? (asString(data.employeeusername) ?? ctx.username)
              : ctx.username;
          this.audit.apiCall(apiName, { ...ctx, username, status });
        },
        error: (err: unknown) =>
          this.audit.apiCall(apiName, { ...ctx, status: 'error', errorCode: errorCode(err) }),
      }),
    );
  }
}
