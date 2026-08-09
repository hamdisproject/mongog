import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { packagedApplication, parseArguments, requireTarget } from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const platform = String(args.get('platform') ?? process.platform);
const arch = String(args.get('arch') ?? process.arch);
requireTarget(platform, arch);
const executable = process.env.MONGOG_PACKAGED_EXECUTABLE?.trim() || packagedApplication(platform, arch).executable;
const mongo = await MongoMemoryServer.create();
let child;
let output = '';
let timeout;

try {
  child = spawn(executable, [], {
    env: {
      ...process.env,
      MONGOG_SMOKE: '1',
      MONGOG_SMOKE_MONGO_URI: mongo.getUri('mongog_packaged_smoke'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => {
    const text = String(chunk);
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    output += text;
    process.stderr.write(text);
  });
  const exitCode = await Promise.race([
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Packaged smoke timed out after 180 seconds.')), 180_000);
    }),
  ]);
  if (exitCode !== 0 || !output.includes('SMOKE: PASS')) {
    throw new Error(`Packaged smoke failed with exit code ${exitCode}.`);
  }
  console.log(`Packaged smoke passed for ${platform}:${arch}.`);
} finally {
  if (timeout) clearTimeout(timeout);
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await mongo.stop();
}
