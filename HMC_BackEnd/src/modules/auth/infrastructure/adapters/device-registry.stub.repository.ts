import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  DeviceBindingCommand,
  DeviceRegistration,
  DeviceRegistryPort,
} from '../../domain/ports/device-registry.port';

/**
 * Stub device-binding registry (audit Level 3). Throws 501 until the device
 * trust store is provided. In non-production the services short-circuit.
 * TODO(spec): implement the user↔device trust store.
 */
@Injectable()
export class DeviceRegistryStubRepository implements DeviceRegistryPort {
  bind(_cmd: DeviceBindingCommand): Promise<void> {
    throw new NotImplementedException(
      'Device registry is not wired yet — provide the device-binding store spec. [TODO(spec)]',
    );
  }

  isBound(_username: string, _imei: string): Promise<boolean> {
    throw new NotImplementedException(
      'Device registry is not wired yet — provide the device-binding store spec. [TODO(spec)]',
    );
  }

  find(_username: string, _imei: string): Promise<DeviceRegistration | undefined> {
    throw new NotImplementedException(
      'Device registry is not wired yet — provide the device-binding store spec. [TODO(spec)]',
    );
  }
}
