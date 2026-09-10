export interface PersonIdentityPort {
  findPersonId(username: string): Promise<string | undefined>;
}

export const PERSON_IDENTITY_PORT = Symbol('PERSON_IDENTITY_PORT');
