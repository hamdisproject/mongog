export const UPDATE_CONFIG: Readonly<{
  provider: 'generic';
  url: 'https://mongog.com/update';
  updaterCacheDirName: 'mongog-updater';
}>;
export function parseUpdateConfig(source: string): typeof UPDATE_CONFIG;
