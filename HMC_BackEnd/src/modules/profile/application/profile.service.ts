import { Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LookupsService } from '@lookups/application/lookups.service';
import { WorklistService } from '../../approvals/application/approvals.service';
import { EmployeeProfile } from '../domain/entities/employee-profile';
import { PROFILE_REPOSITORY, ProfileRepository } from '../domain/profile.repository';

/** Application service for profile (ops 2, 48, 63). */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(PROFILE_REPOSITORY) private readonly repo: ProfileRepository,
    private readonly lookups: LookupsService,
    private readonly worklist: WorklistService,
  ) {}

  getProfile(username: string, lang: Lang): Promise<EmployeeProfile> {
    return this.repo.getProfile(username, lang);
  }

  /**
   * Notification list — the user's workflow notifications from WORKLISTS_V
   * (getworklist documented query: `(RECIPIENT_ROLE = :u AND MORE_INFO_ROLE IS
   * NULL) OR MORE_INFO_ROLE = :u`). Delegates to the approvals module's
   * WorklistService so the SQL is implemented once (op 68 shares it).
   */
  notifications(username: string, lang: Lang) {
    return this.worklist.worklist(username, lang);
  }

  /**
   * Notification summary — op 69's getworklistsummary query: the same
   * WORKLISTS_V role filter additionally scoped to one NOTIFICATION_ID
   * (omitted = the full list, same as `notifications`).
   */
  notificationSummary(username: string, lang: Lang, notificationId?: string) {
    return this.worklist.worklistSummary(username, lang, notificationId);
  }

  /**
   * Notification action history — op 70's getworklistactionhistory query:
   * `SELECT rownum sequence_num, v.* FROM ACTION_HISTORY_V v WHERE ITEM_TYPE =
   * :type AND ITEM_KEY = :key` (type defaults to HRSSA).
   */
  notificationHistory(itemKey: string, lang: Lang, itemType?: string) {
    return this.worklist.history(itemKey, lang, itemType);
  }

  updatePersonal(
    fields: Record<string, unknown>,
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    return this.repo.updatePersonal({ username: user.username, lang, fields });
  }

  maritalStatusLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.EMP_MARITAL_LOV, lang);
  }
}
