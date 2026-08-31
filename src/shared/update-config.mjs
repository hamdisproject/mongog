import { JSON_SCHEMA, load } from 'js-yaml';

export const UPDATE_CONFIG = Object.freeze({
  provider: 'generic',
  url: 'https://mongog.com/update',
  updaterCacheDirName: 'mongog-updater',
});

/** Shared by package verification and main-process startup, never the renderer. */
export function parseUpdateConfig(source) {
  // Use the same YAML parser as electron-updater, including duplicate-key
  // rejection. Never include the source/configuration in an error message.
  let config;
  try {
    config = load(source, { schema: JSON_SCHEMA });
  } catch {
    throw new Error('Invalid packaged update configuration.');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.entries(UPDATE_CONFIG).some(([key, value]) => config[key] !== value)) {
    throw new Error('Invalid packaged update configuration.');
  }
  return UPDATE_CONFIG;
}
