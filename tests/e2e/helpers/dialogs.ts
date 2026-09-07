import type { ElectronApplication } from '@playwright/test';

export async function redirectSaveDialogs(app: ElectronApplication, directory: string): Promise<void> {
  await app.evaluate(({ dialog }, targetDirectory) => {
    const target = dialog as unknown as {
      showSaveDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePath: string }>;
    };
    target.showSaveDialog = async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string };
      const filename = String(options.defaultPath ?? 'export.dat').replace(/^.*[\\/]/u, '');
      return { canceled: false, filePath: `${targetDirectory}/${filename}` };
    };
  }, directory);
}

export async function redirectOpenDialogs(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    const target = dialog as unknown as {
      showOpenDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>;
    };
    target.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, filePaths);
}
