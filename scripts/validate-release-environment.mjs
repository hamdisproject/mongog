import { Buffer } from 'node:buffer';
import { packageMetadata, parseArguments, releaseTagVersion } from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const platform = String(args.get('platform') ?? '');
const tag = String(args.get('tag') ?? (process.env.RELEASE_TAG?.trim() || process.env.CIRCLE_TAG?.trim() || ''));
const version = releaseTagVersion(tag);

if (version !== packageMetadata.version) {
  throw new Error(`Tag ${tag} does not match package.json version ${packageMetadata.version}.`);
}
if (process.env.MONGOG_RELEASE !== '1') {
  throw new Error('MONGOG_RELEASE=1 is required for release validation.');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for ${platform} release signing.`);
  return value;
}

function requiredBase64(name) {
  const value = required(name);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length < 32 || decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/\s+/gu, '').replace(/=+$/u, '')) {
    throw new Error(`${name} is not valid base64 signing material.`);
  }
}

if (!['darwin', 'win32', 'linux'].includes(platform)) {
  throw new Error(`Unsupported release platform: ${platform}`);
}

const signed = platform === 'darwin';
if (signed && process.env.MONGOG_SIGN_RELEASE !== '1') {
  throw new Error(`MONGOG_SIGN_RELEASE=1 is required for production ${platform} releases.`);
}
if (signed && platform === 'darwin') {
  requiredBase64('MACOS_CERTIFICATE_P12_BASE64');
  required('MACOS_CERTIFICATE_PASSWORD');
  required('MACOS_SIGN_IDENTITY');
  requiredBase64('APPLE_API_KEY_P8_BASE64');
  required('APPLE_API_KEY_ID');
  required('APPLE_API_ISSUER_ID');
}

console.log(`${signed ? 'Signed' : 'Unsigned'} release environment validated for ${platform} ${tag}.`);
