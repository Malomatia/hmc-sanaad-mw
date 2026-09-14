/**
 * MPIN persistence port (APIs 4/5/7). The `mpin` passed in is the value received
 * from the client (per the framework doc, the client pre-hashes); the adapter is
 * responsible for salting + hashing at rest (see MpinHasher) and constant-time
 * verification. Spec/store pending.
 */
export interface SetMpinCommand {
  username: string;
  imei: string;
  mpin: string;
}

export interface VerifyMpinQuery {
  username: string;
  imei: string;
  mpin: string;
}

export interface MpinStorePort {
  /** Create/overwrite the MPIN bound to username + device. */
  set(cmd: SetMpinCommand): Promise<void>;
  /** Constant-time verify of a presented MPIN for a username + device. */
  verify(query: VerifyMpinQuery): Promise<boolean>;
  /** True if the user already has an MPIN registered on this device. */
  exists(username: string, imei: string): Promise<boolean>;
}

export const MPIN_STORE_PORT = Symbol('MPIN_STORE_PORT');
