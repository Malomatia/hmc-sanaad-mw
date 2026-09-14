import { ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { EntraConfig } from '@core/config/configuration';
import { EntraGraphUserRepository } from './entra-graph-user.repository';

const CONFIG: EntraConfig = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  graphBaseUrl: 'https://graph.microsoft.com/v1.0',
  loginBaseUrl: 'https://login.microsoftonline.com',
  lookupAttribute: 'userPrincipalName',
  timeoutMs: 10000,
};

const ok = <T>(data: T): AxiosResponse<T> =>
  ({ data, status: 200, statusText: 'OK', headers: {}, config: {} }) as AxiosResponse<T>;

const notFound = (): AxiosError => {
  const err = new AxiosError('Request failed with status code 404');
  err.response = { status: 404, statusText: 'Not Found', data: {}, headers: {}, config: {} } as never;
  return err;
};

const tokenResponse = ok({ access_token: 'graph-token', expires_in: 3600 });

const GRAPH_USER = {
  userPrincipalName: 'jane.doe@hmc.org.qa',
  displayName: 'Jane Doe',
  givenName: 'Jane',
  surname: 'Doe',
  mail: 'jane.doe@hmc.org.qa',
  mobilePhone: '77861234',
  businessPhones: ['44391000'],
  department: 'ICT',
  companyName: 'HMC',
  employeeId: '123456',
};

function makeRepo(config: Partial<EntraConfig> = {}) {
  const http = { get: jest.fn(), post: jest.fn() } as unknown as jest.Mocked<HttpService>;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ ...CONFIG, ...config }),
  } as unknown as ConfigService;
  const repo = new EntraGraphUserRepository(http, configService);
  return { repo, http };
}

describe('EntraGraphUserRepository', () => {
  const query = { username: 'jane.doe@hmc.org.qa', imei: 'imei-1' };

  it('acquires a token once and reuses it across calls', async () => {
    const { repo, http } = makeRepo();
    http.post.mockReturnValue(of(tokenResponse));
    http.get.mockReturnValue(of(ok(GRAPH_USER)));

    await repo.validate(query);
    await repo.validate(query);

    expect(http.post).toHaveBeenCalledTimes(1); // token cached
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('resolves a user by UPN and maps the identity', async () => {
    const { repo, http } = makeRepo();
    http.post.mockReturnValue(of(tokenResponse));
    http.get.mockReturnValue(of(ok(GRAPH_USER)));

    const identity = await repo.validate(query);

    expect(http.get).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/users/jane.doe%40hmc.org.qa',
      expect.objectContaining({ params: expect.objectContaining({ $select: expect.any(String) }) }),
    );
    expect(identity).toMatchObject({
      username: 'jane.doe@hmc.org.qa',
      employeeNumber: '123456',
      employeeName: 'Jane Doe',
      department: 'ICT',
      company: 'HMC',
      phoneNumber: '77861234',
      isEmployee: true,
      isNewUser: false,
    });
  });

  it('falls back to an OData $filter lookup on 404', async () => {
    const { repo, http } = makeRepo();
    http.post.mockReturnValue(of(tokenResponse));
    http.get
      .mockReturnValueOnce(throwError(() => notFound()))
      .mockReturnValueOnce(of(ok({ value: [GRAPH_USER] })));

    const identity = await repo.validate(query);

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenLastCalledWith(
      'https://graph.microsoft.com/v1.0/users',
      expect.objectContaining({
        params: expect.objectContaining({
          $filter: "userPrincipalName eq 'jane.doe@hmc.org.qa'",
          $top: 1,
        }),
      }),
    );
    expect(identity.isEmployee).toBe(true);
  });

  it('marks a user without employeeId as not an employee', async () => {
    const { repo, http } = makeRepo();
    http.post.mockReturnValue(of(tokenResponse));
    http.get.mockReturnValue(of(ok({ ...GRAPH_USER, employeeId: undefined })));

    const identity = await repo.validate(query);

    expect(identity.isEmployee).toBe(false);
    expect(identity.employeeNumber).toBeUndefined();
  });

  it('returns isEmployee:false when the user is not found at all', async () => {
    const { repo, http } = makeRepo();
    http.post.mockReturnValue(of(tokenResponse));
    http.get
      .mockReturnValueOnce(throwError(() => notFound()))
      .mockReturnValueOnce(of(ok({ value: [] })));

    const identity = await repo.validate(query);

    expect(identity.isEmployee).toBe(false);
  });

  it('wraps Graph errors as ServiceUnavailable', async () => {
    const { repo, http } = makeRepo();
    http.post.mockReturnValue(of(tokenResponse));
    http.get.mockReturnValue(throwError(() => new Error('graph 500')));

    await expect(repo.validate(query)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws ServiceUnavailable when Entra is not configured', async () => {
    const { repo } = makeRepo({ tenantId: '', clientId: '', clientSecret: '' });

    await expect(repo.validate(query)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('authenticate() is not supported (501)', async () => {
    const { repo } = makeRepo();
    expect(() => repo.authenticate({ username: 'x', password: 'y' })).toThrow();
  });
});
