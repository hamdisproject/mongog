import { describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/storage/database.js';
import {
  getOrCreateUpdateDeviceId,
  isUpdateDeviceId,
  UPDATE_DEVICE_ID_SETTING_KEY,
} from '../../../src/main/services/update-device-identity.js';
import { useTempDatabase } from './helpers/temp-database.js';

describe('update device identity', () => {
  const context = useTempDatabase('mongog-update-device-');

  it('creates a UUID v4 and preserves it when the database is reopened', () => {
    const firstDatabase = Database.openOrCreate(context.path);
    const first = getOrCreateUpdateDeviceId(firstDatabase.settings);
    firstDatabase.close();

    const reopened = Database.openOrCreate(context.path);
    const second = getOrCreateUpdateDeviceId(reopened.settings);
    reopened.close();

    expect(isUpdateDeviceId(first)).toBe(true);
    expect(second).toBe(first);
  });

  it('replaces a malformed stored value with a valid UUID v4', () => {
    const values = new Map([[UPDATE_DEVICE_ID_SETTING_KEY, 'not-a-uuid']]);
    const settings = {
      getRaw: (key: string) => values.get(key) ?? null,
      setRaw: (key: string, value: string) => values.set(key, value),
    };

    const deviceId = getOrCreateUpdateDeviceId(settings);

    expect(isUpdateDeviceId(deviceId)).toBe(true);
    expect(values.get(UPDATE_DEVICE_ID_SETTING_KEY)).toBe(deviceId);
  });

  it('returns null instead of an ephemeral UUID when persistence fails', () => {
    const settings = {
      getRaw: vi.fn(() => null),
      setRaw: vi.fn(() => { throw new Error('database is read-only'); }),
    };

    expect(getOrCreateUpdateDeviceId(settings)).toBeNull();
    expect(settings.setRaw).toHaveBeenCalledOnce();
  });
});
