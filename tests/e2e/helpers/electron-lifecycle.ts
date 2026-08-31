import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ElectronApplication } from '@playwright/test';

const execFileAsync = promisify(execFile);

async function within<T>(operation: Promise<T>, timeoutMS: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A failed quit must fail the test, but must not leave Electron holding userData. */
export async function closeElectron(application: ElectronApplication, timeoutMS = 20_000): Promise<void> {
  const child = application.process();
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  let onClose: () => void = () => undefined;
  const closed = hasExited() ? Promise.resolve() : new Promise<void>((resolve) => {
    onClose = resolve;
    // Unlike exit, close also waits for stdio inherited by child processes.
    child.once('close', onClose);
  });

  try {
    await within((async () => {
      if (!hasExited()) {
        // Return the inspector response before quitting. Calling app.quit()
        // directly inside an inspector evaluation can strand that evaluation.
        await application.evaluate(({ app }) => { setImmediate(() => app.quit()); });
      }
      await closed;
      await application.close();
    })(), timeoutMS, `Electron did not quit within ${timeoutMS}ms (pid ${child.pid}).`);
    if (child.exitCode !== 0 || child.signalCode !== null) {
      throw new Error(`Electron exited abnormally (code ${child.exitCode}, signal ${child.signalCode}).`);
    }
  } catch (error) {
    // Kill only the process tree owned by this Playwright launch. On Windows
    // process() is the cmd.exe wrapper, so killing just that PID is insufficient.
    if (!hasExited() && child.pid) {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 5_000 });
      } else {
        // Playwright launches Unix processes in their own process group.
        try { process.kill(-child.pid, 'SIGKILL'); } catch (killError) {
          if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') throw killError;
        }
      }
      await within(closed, 5_000, 'Electron process tree did not stop after forced cleanup.');
    }
    throw error;
  } finally {
    child.off('close', onClose);
  }
}

export async function removeElectronUserData(directory: string): Promise<void> {
  // Chromium/Windows may release DIPS and cache handles just after process exit.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
