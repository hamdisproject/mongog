import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArguments } from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const platform = String(args.get('platform') ?? '');
const outputDirectory = path.resolve(String(args.get('directory') ?? ''));
if (!args.get('directory')) throw new Error('--directory is required.');
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

function writeSecret(filename, environmentName) {
  const encoded = process.env[environmentName]?.trim();
  if (!encoded) throw new Error(`${environmentName} is required.`);
  const destination = path.join(outputDirectory, filename);
  writeFileSync(destination, Buffer.from(encoded, 'base64'), { mode: 0o600 });
  chmodSync(destination, 0o600);
  return destination;
}

if (platform !== 'darwin') throw new Error(`Signing assets are not defined for ${platform}.`);
writeSecret('mongog-release-certificate.p12', 'MACOS_CERTIFICATE_P12_BASE64');
writeSecret('apple-api-key.p8', 'APPLE_API_KEY_P8_BASE64');

console.log(`Signing files materialized in the ephemeral runner directory for ${platform}.`);
