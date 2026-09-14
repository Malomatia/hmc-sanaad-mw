import { Logger } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLevel } from './audit-event';
import { AuditSink } from './ports/audit-sink.port';

describe('AuditService', () => {
  const write = jest.fn();
  const sink: AuditSink = { write };
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    write.mockReset();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits one API record with a server timestamp and correlation context', () => {
    const service = new AuditService(sink);

    service.apiCall('GET /api/v1/employee/profile', { username: 'hmc1', status: 'success' });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        auditId: expect.any(String),
        timestamp: expect.any(String),
        level: AuditLevel.API_CALL,
        apiName: 'GET /api/v1/employee/profile',
        username: 'hmc1',
        status: 'success',
      }),
    );
  });

  it('does not wait for database persistence', () => {
    write.mockReturnValue(new Promise<void>(() => undefined));

    expect(new AuditService(sink).apiCall('GET /api/v1/employee/profile')).toBeUndefined();
  });

  it('contains a synchronous sink failure', () => {
    write.mockImplementation(() => {
      throw new Error('sink unavailable');
    });

    expect(() => new AuditService(sink).apiCall('GET /api/v1/employee/profile')).not.toThrow();
    expect(errorLog).toHaveBeenCalledWith('Audit sink failed: sink unavailable');
  });

  it.each([new Error('database unavailable'), 'database unavailable', null])(
    'contains an asynchronous sink rejection (%s)',
    async (err) => {
      write.mockRejectedValue(err);

      expect(() => new AuditService(sink).apiCall('GET /api/v1/employee/profile')).not.toThrow();
      await new Promise<void>((resolve) => setImmediate(resolve));

      const message = err instanceof Error ? err.message : String(err);
      expect(errorLog).toHaveBeenCalledWith(`Audit sink failed: ${message}`);
    },
  );
});
