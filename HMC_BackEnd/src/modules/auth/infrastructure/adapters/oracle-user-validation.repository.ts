import { Injectable, Logger } from '@nestjs/common';
import oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { OracleUserValidationPort } from '../../domain/ports/oracle-user-validation.port';

@Injectable()
export class OracleUserValidationRepository implements OracleUserValidationPort {
  private readonly logger = new Logger(OracleUserValidationRepository.name);

  constructor(private readonly ora: OracleService) {}

  async validate(username: string): Promise<boolean> {
    const userName = username.trim().toUpperCase();
    if (!userName || !this.ora.isConfigured()) return false;

    try {
      const out = await this.ora.call<{ p_is_valid?: string | null }>(
        `BEGIN ${ORACLE_OBJECTS.USER_VALIDATE_PRC}(p_user_name => :p_user_name, p_is_valid => :p_is_valid); END;`,
        {
          p_user_name: userName,
          p_is_valid: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
        },
      );
      return out.p_is_valid?.trim().toLowerCase() === 'true';
    } catch {
      this.logger.warn(`${ORACLE_OBJECTS.USER_VALIDATE_PRC} failed; restricting login functions.`);
      return false;
    }
  }
}
