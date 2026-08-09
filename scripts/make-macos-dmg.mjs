import { spawn } from 'node:child_process';
import { isRecoverableDmgDetachFailure, parseArguments, requireTarget } from './release-utils.mjs';

const args = parseArguments(process.argv.slice(2));
const arch = String(args.get('arch') ?? process.arch);
requireTarget('darwin', arch);

if (process.platform !== 'darwin') {
  throw new Error('The macOS DMG maker must run on macOS.');
}

const makeArguments = [
  'run',
  'make',
  '--',
  '--skip-package',
  '--platform=darwin',
  `--arch=${arch}`,
  '--targets=@electron-forge/maker-dmg',
];

async function runMake() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', makeArguments, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const retain = (chunk, destination) => {
      const text = chunk.toString();
      destination.write(text);
      output = `${output}${text}`.slice(-128 * 1024);
    };
    child.stdout.on('data', (chunk) => retain(chunk, process.stdout));
    child.stderr.on('data', (chunk) => retain(chunk, process.stderr));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code: code ?? 1, signal, output }));
  });
}

let result = await runMake();
if (result.code !== 0 && isRecoverableDmgDetachFailure(result.output)) {
  console.warn('The temporary DMG volume was already detached; retrying the DMG maker once.');
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  result = await runMake();
}

if (result.code !== 0) {
  throw new Error(`macOS DMG maker failed with exit code ${result.code}${result.signal ? ` (${result.signal})` : ''}.`);
}
