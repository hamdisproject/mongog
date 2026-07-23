/**
 * IPC registry (plan §G/§J): allowlisted channels, zod-validated payloads,
 * sender validation. Handlers never leak raw errors — always AppError.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { appError, serializeError, type AppError } from '../../shared/errors/index.js';
import type { IpcResult } from '../../shared/ipc/index.js';

export type SenderValidator = (event: IpcMainInvokeEvent) => boolean;

type Handler<S extends z.ZodType, R> = (
  payload: z.infer<S>,
  event: IpcMainInvokeEvent,
) => Promise<R>;

const registered = new Set<string>();

export function registerChannel<S extends z.ZodType, R>(
  channel: string,
  schema: S,
  handler: Handler<S, R>,
  validateSender: SenderValidator,
): void {
  if (registered.has(channel)) throw new Error(`Duplicate IPC channel: ${channel}`);
  registered.add(channel);

  ipcMain.handle(channel, async (event, rawPayload): Promise<IpcResult<R>> => {
    try {
      if (!validateSender(event)) {
        return { ok: false, error: appError('Unknown', 'IPC sender rejected.') };
      }
      const parsed = schema.safeParse(rawPayload ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: appError('Unknown', `Invalid IPC payload for ${channel}`, {
            causeMessage: parsed.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
          }),
        };
      }
      const value = await handler(parsed.data, event);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: serializeError(err) as AppError };
    }
  });
}

export function registeredChannels(): string[] {
  return [...registered];
}
