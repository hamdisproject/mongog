import { describe, expect, it, vi } from 'vitest';
import {
  isTransientAppleTicketFailure,
  retryAppleTicketOperation,
} from '../../../scripts/retry-apple-network.mjs';

const networkError = 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."\n'
  + 'https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup\n';
const failure = { code: 68, output: `${networkError}The validate action failed! Error 68.` };
const success = { code: 0, output: 'The validate action worked!' };

function hooks() {
  return { wait: vi.fn(async (_ms: number) => undefined), warn: vi.fn() };
}

describe('Apple ticket network retries', () => {
  it.each([
    'The staple and validate action failed! Error 68.',
    'The validate action failed! Error 68.',
    'Failed to staple your application with code: 68',
  ])('recognizes the observed ticket lookup failure: %s', (message) => {
    expect(isTransientAppleTicketFailure(`${networkError}${message}`)).toBe(true);
  });

  it.each([
    'The validate action failed! Error 68. Ticket not found.',
    `${networkError}codesign: invalid signature`,
    `${networkError}notarytool: status: Invalid`,
    failure.output.replace('api.apple-cloudkit.com', 'example.com'),
    failure.output.replace('Code=-1005', 'Code=-1202'),
  ])('leaves other failures fatal: %s', (output) => {
    expect(isTransientAppleTicketFailure(output)).toBe(false);
  });

  it('retries the same operation after a temporary disconnect', async () => {
    const operation = vi.fn().mockResolvedValueOnce(failure).mockResolvedValueOnce(success);
    const options = hooks();
    expect(await retryAppleTicketOperation(operation, options)).toEqual(success);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(options.wait.mock.calls).toEqual([[15_000]]);
    expect(options.warn).toHaveBeenCalledTimes(1);
  });

  it('stops after four failed attempts and preserves the failure', async () => {
    const operation = vi.fn().mockResolvedValue(failure);
    const options = hooks();
    expect(await retryAppleTicketOperation(operation, options)).toEqual(failure);
    expect(operation).toHaveBeenCalledTimes(4);
    expect(options.wait.mock.calls).toEqual([[15_000], [30_000], [60_000]]);
  });

  it('returns immediately for a successful command', async () => {
    const operation = vi.fn().mockResolvedValue(success);
    const options = hooks();
    expect(await retryAppleTicketOperation(operation, options)).toEqual(success);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(options.wait).not.toHaveBeenCalled();
  });

  it('does not retry a signature or notarization rejection', async () => {
    const rejected = { code: 1, output: 'The signature is invalid; status: Invalid' };
    const operation = vi.fn().mockResolvedValue(rejected);
    const options = hooks();
    expect(await retryAppleTicketOperation(operation, options)).toEqual(rejected);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(options.wait).not.toHaveBeenCalled();
  });

  it('propagates failures to start a command', async () => {
    const error = new Error('spawn ENOENT');
    const operation = vi.fn().mockRejectedValue(error);
    const options = hooks();
    await expect(retryAppleTicketOperation(operation, options)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(options.wait).not.toHaveBeenCalled();
  });
});
