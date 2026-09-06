export interface DeviceBindingCommand {
  username: string;
  imei: string;
  platform?: string;
}

/** Registration row for a user↔device pair (HMC_Sanad_DeviceRegn_tbl). */
export interface DeviceRegistration {
  /** An MPIN is stored for this device (existing user). */
  mpinSet: boolean;
  /** Status column ('Active' / 'Inactive'), when the table has it. */
  status?: string;
  registeredAt?: Date;
}

/**
 * Device-binding trust registry (audit Level 3). Records user↔device trust used
 * for device-mismatch detection and MPIN-reset-on-new-device flows. A freshly
 * bound device has NO MPIN and status 'Inactive'; setting the MPIN (API-4)
 * activates it.
 */
export interface DeviceRegistryPort {
  bind(cmd: DeviceBindingCommand): Promise<void>;
  isBound(username: string, imei: string): Promise<boolean>;
  /** The registration row for this exact user+device, or undefined. */
  find(username: string, imei: string): Promise<DeviceRegistration | undefined>;
}

export const DEVICE_REGISTRY_PORT = Symbol('DEVICE_REGISTRY_PORT');
