import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const RETRY_DELAYS_MS = [15_000, 30_000, 60_000];

/** A failed Apple ticket lookup, rather than a rejected signature or notarization. */
export function isTransientAppleTicketFailure(output) {
  return /api\.apple-cloudkit\.com/iu.test(output)
    && /NSURLErrorDomain\s+Code=-1005\b/iu.test(output)
    && /(?:Failed to staple your application with code:\s*68\b|The (?:staple and validate|validate) action failed! Error 68\b)/iu.test(output);
}

export async function retryAppleTicketOperation(operation, { wait = delay, warn = console.warn } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const result = await operation();
    if (result.code === 0 || !isTransientAppleTicketFailure(result.output) || attempt === RETRY_DELAYS_MS.length) {
      return result;
    }
    const waitMS = RETRY_DELAYS_MS[attempt];
    warn(`Apple ticket lookup lost its network connection; retrying in ${waitMS / 1000}s (${attempt + 2}/4).`);
    await wait(waitMS);
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const retain = (chunk, destination) => {
      destination.write(chunk);
      output = `${output}${chunk.toString()}`.slice(-128 * 1024);
    };
    child.stdout.on('data', (chunk) => retain(chunk, process.stdout));
    child.stderr.on('data', (chunk) => retain(chunk, process.stderr));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Usage: node scripts/retry-apple-network.mjs <command> [args...]');
  const result = await retryAppleTicketOperation(() => runCommand(command, args));
  process.exitCode = result.code;
}
