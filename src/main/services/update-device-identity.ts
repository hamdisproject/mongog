import { randomUUID } from 'node:crypto';
import type { SettingsRepo } from '../storage/repositories/settings.js';

export const UPDATE_DEVICE_ID_HEADER = 'X-MongoG-Device-Id';
export const UPDATE_DEVICE_ID_SETTING_KEY = 'updates:device-id';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeviceIdentitySettings = Pick<SettingsRepo, 'getRaw' | 'setRaw'>;

export function isUpdateDeviceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

/**
 * Returns one pseudonymous installation identifier for update requests.
 * Persistence failures deliberately produce no identifier: an ephemeral UUID
 * would make one installation look like a new device after every launch.
 */
export function getOrCreateUpdateDeviceId(settings: DeviceIdentitySettings): string | null {
  try {
    const existing = settings.getRaw(UPDATE_DEVICE_ID_SETTING_KEY);
    if (isUpdateDeviceId(existing)) return existing;

    const deviceId = randomUUID();
    settings.setRaw(UPDATE_DEVICE_ID_SETTING_KEY, deviceId);
    return deviceId;
  } catch {
    return null;
  }
}
