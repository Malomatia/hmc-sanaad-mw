import { Injectable, Logger } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { normalizePersonId } from '@shared/domain/caller-identity';
import { PersonIdentityPort } from '../../domain/ports/person-identity.port';

@Injectable()
export class PersonIdentityOracleRepository implements PersonIdentityPort {
  private readonly logger = new Logger(PersonIdentityOracleRepository.name);

  constructor(private readonly oracle: OracleService) {}

  async findPersonId(username: string): Promise<string | undefined> {
    if (!this.oracle.isReady()) return undefined;
    const rows = await this.oracle.query<{ PERSON_ID: unknown }>(
      `SELECT PERSON_ID FROM ${ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V} WHERE USER_NAME = :username`,
      { username: username.toUpperCase() },
    );
    const ids = new Set(rows.map((row) => normalizePersonId(row.PERSON_ID)));
    if (ids.size !== 1 || ids.has(undefined)) {
      this.logger.warn('Login PERSON_ID lookup returned no unambiguous valid identity.');
      return undefined;
    }
    return ids.values().next().value;
  }
}
