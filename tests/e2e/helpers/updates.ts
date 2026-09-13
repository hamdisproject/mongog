import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type ElectronApplication } from '@playwright/test';

export async function inspectUpdateConfiguration(application: ElectronApplication, expectedCachePath: string): Promise<void> {
  const configuration = await application.evaluate(({ app }) => {
    const require = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`);
    const { autoUpdater } = require('electron-updater');
    return {
      type: autoUpdater.constructor.name,
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      cachePath: autoUpdater.app.baseCachePath,
    };
  });
  expect(configuration).toEqual({
    type: process.platform === 'darwin'
      ? 'MacUpdater'
      : process.platform === 'win32'
        ? 'NsisUpdater'
        : 'RpmUpdater',
    autoDownload: process.platform === 'win32',
    autoInstallOnAppQuit: false,
    cachePath: expectedCachePath,
  });
}

export async function startUpdateFeed(version: string, failure?: 'checksum' | 'http'): Promise<{
  url: string;
  manifest: string;
  artifact: string;
  sha512: string;
  requests: string[];
  observations: Array<{ path: string; deviceId: string | null }>;
  close: () => Promise<void>;
}> {
  const manifest = process.platform === 'darwin'
    ? 'latest-mac.yml'
    : process.platform === 'win32'
      ? 'latest.yml'
      : 'latest-linux.yml';
  const artifact = process.platform === 'darwin'
    ? `MongoG-${version}-macOS-${process.arch}.zip`
    : process.platform === 'win32'
      ? `MongoG-Setup-${version}-UNSIGNED-win-x64.exe`
      : `mongog-${version}-1.x86_64.rpm`;
  // Small download-only fixture (an empty ZIP on macOS). The tests never invoke
  // the native installer, but exercise actual HTTP, cache writes and SHA-512.
  const payload = process.platform === 'darwin'
    ? Buffer.from('504b0506000000000000000000000000000000000000', 'hex')
    : Buffer.from(`MongoG ${process.platform === 'win32' ? 'NSIS' : 'RPM'} download-only test fixture\n`);
  const sha512 = failure === 'checksum'
    ? Buffer.alloc(64, 7).toString('base64')
    : createHash('sha512').update(payload).digest('base64');
  const body = [
    `version: "${version}"`,
    'files:',
    `  - url: "${artifact}"`,
    `    sha512: "${sha512}"`,
    `    size: ${payload.length}`,
    `path: "${artifact}"`,
    `sha512: "${sha512}"`,
    '',
  ].join('\n');
  const requests: string[] = [];
  const observations: Array<{ path: string; deviceId: string | null }> = [];
  const server = createServer((request, response) => {
    const requestUrl = request.url ?? '/';
    const pathname = requestUrl.split('?', 1)[0] ?? '/';
    requests.push(pathname);
    const rawDeviceId = request.headers['x-mongog-device-id'];
    observations.push({
      path: pathname,
      deviceId: typeof rawDeviceId === 'string' ? rawDeviceId : null,
    });
    if (pathname === `/update/${manifest}`) {
      response.writeHead(200, { 'Content-Type': 'text/yaml', 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }
    if (pathname === `/update/${artifact}`) {
      if (failure === 'http') {
        response.writeHead(503);
        response.end('Update fixture unavailable');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length });
        response.end(payload);
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/update`,
    manifest,
    artifact,
    sha512,
    requests,
    observations,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
