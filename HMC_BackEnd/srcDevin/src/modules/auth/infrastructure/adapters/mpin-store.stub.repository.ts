import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  MpinStorePort,
  SetMpinCommand,
  VerifyMpinQuery,
} from '../../domain/ports/mpin-store.port';

/**
 * Stub MPIN store. Throws 501 until the MPIN persistence layer is provided.
 * A real adapter must salt+hash at rest (see MpinHasher) and verify in constant
 * time. In non-production the services short-circuit (dev bypass).
 * TODO(spec): implement against the MPIN store (APIs 4/5/7).
 */
@Injectable()
export class MpinStoreStubRepository implements MpinStorePort {
  set(_cmd: SetMpinCommand): Promise<void> {
    throw new NotImplementedException(
      'MPIN store is not wired yet — provide the MPIN persistence spec. [TODO(spec) API-4/7]',
    );
  }

  verify(_query: VerifyMpinQuery): Promise<boolean> {
    throw new NotImplementedException(
      'MPIN verification is not wired yet — provide the MPIN store spec. [TODO(spec) API-5]',
    );
  }

  exists(_username: string, _imei: string): Promise<boolean> {
    throw new NotImplementedException(
      'MPIN store is not wired yet — provide the MPIN persistence spec. [TODO(spec)]',
    );
  }
}
