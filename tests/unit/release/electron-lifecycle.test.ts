import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeElectron, removeElectronUserData } from '../../e2e/helpers/electron-lifecycle.js';

const { execFile, rm } = vi.hoisted(() => ({ execFile: vi.fn(), rm: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('node:fs/promises', () => ({ rm }));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

beforeEach(() => {
  vi.useFakeTimers();
  execFile.mockReset();
  rm.mockReset();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fakeApplication() {
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null as number | null, signalCode: null as string | null });
  const evaluate = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const application = { process: () => child as ChildProcess, evaluate, close } as unknown as ElectronApplication;
  const exit = (code = 0) => {
    child.exitCode = code;
    child.emit('exit', code, null);
  };
  const closeProcess = () => child.emit('close', child.exitCode, child.signalCode);
  return { child, evaluate, close, application, exit, closeProcess };
}

describe('packaged Electron lifecycle', () => {
  it('waits for process close, including inherited stdio, before allowing a relaunch', async () => {
    const app = fakeApplication();
    const stopped = vi.fn();
    const result = closeElectron(app.application, 100).then(stopped);
    await vi.advanceTimersByTimeAsync(1);
    app.exit();
    await vi.advanceTimersByTimeAsync(1);
    expect(stopped).not.toHaveBeenCalled();
    expect(app.close).not.toHaveBeenCalled();
    app.closeProcess();
    await result;
    expect(stopped).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(app.child.listenerCount('close')).toBe(0);
  });

  it('fails an abnormal exit instead of treating it as a successful persistence restart', async () => {
    const app = fakeApplication();
    app.exit(1);
    await expect(closeElectron(app.application, 100)).rejects.toThrow('exited abnormally');
    expect(app.evaluate).not.toHaveBeenCalled();
  });

  it('bounds a hung quit, kills only its Unix process group, and still fails the test', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const app = fakeApplication();
    app.evaluate.mockImplementation(() => new Promise(() => undefined));
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      app.child.signalCode = 'SIGKILL';
      app.closeProcess();
      return true;
    });
    const result = expect(closeElectron(app.application, 100)).rejects.toThrow('did not quit within 100ms');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(kill).toHaveBeenCalledExactlyOnceWith(-12345, 'SIGKILL');
    expect(execFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills the Windows shell and its descendants before completing failed teardown', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const app = fakeApplication();
    execFile.mockImplementation((_command, _args, _options, callback) => {
      app.exit(1);
      app.closeProcess();
      callback(null, '', '');
    });
    const result = expect(closeElectron(app.application, 100)).rejects.toThrow('did not quit within 100ms');
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(execFile).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'], { timeout: 5_000 }, expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a quit request error even when forced cleanup succeeds', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const app = fakeApplication();
    app.evaluate.mockRejectedValue(new Error('inspector disconnected'));
    vi.spyOn(process, 'kill').mockImplementation(() => {
      app.child.signalCode = 'SIGKILL';
      app.closeProcess();
      return true;
    });
    await expect(closeElectron(app.application, 100)).rejects.toThrow('inspector disconnected');
  });

  it('uses bounded filesystem retries for Windows DIPS/cache locks', async () => {
    rm.mockResolvedValue(undefined);
    await removeElectronUserData('/temporary/mongog-test');
    expect(rm).toHaveBeenCalledWith('/temporary/mongog-test', {
      recursive: true, force: true, maxRetries: 10, retryDelay: 200,
    });
    rm.mockRejectedValue(new Error('still locked'));
    await expect(removeElectronUserData('/temporary/mongog-test')).rejects.toThrow('still locked');
  });
});
