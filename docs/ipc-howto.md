# IPC how-to (add a channel without breaking the allowlist)

Pattern: `src/main/ipc/registry.ts` (`registerChannel`) → schemas in
`src/shared/ipc/index.ts` → wiring in `src/main/ipc/handlers.ts` →
typed method in `src/preload/preload.ts`. Sender check lives in
`src/main/main.ts:46-50` (`allowedRendererOrigins`, `src/main/window.ts:29-36`).

## Steps

1. **Schema + channel** in `src/shared/ipc/index.ts`:
   - Add a `mongog:<area>:<action>` key to `IpcChannels`.
   - Add `<name>Schema` (zod, `.strict()` for objects) plus request/response
     domain types in `src/shared/domain/`. Reuse `emptySchema`-style
     `z.object({}).strict()` for no-arg channels (see `handlers.ts:147`).
   - Add the method signature to `MongoGDesktopApi` in the same file — preload
     implements exactly this interface, nothing more.
2. **Handler** in `src/main/ipc/handlers.ts` inside `registerIpcHandlers`:
   - Call `registerChannel(IpcChannels.<x>, <x>Schema, async (payload, event) => …,
     validateSender)` — always pass the shared `validateSender`, never a local stub.
   - Return the value directly; `registerChannel` wraps it as
     `IpcResult<T>`. Throw `appError(code, message, { hint })` from
     `src/shared/errors/index.js` for failures — never throw raw errors, never
     include secrets (run URIs/logs through `src/shared/redaction/index.ts`).
   - For connection-scoped ops, resolve via `ConnectionManager` and add a
     `requireWritableConnection(connectionId)` guard when the op mutates data.
   - Execution channels must derive `readOnly` from the resolved profile. Never
     accept `readOnly`, generated code, or a client-selected execution mode from
     renderer SQL payloads (`query.executeSql` is the reference pattern).
3. **Preload** in `src/preload/preload.ts`:
   - Add one `invoke(IpcChannels.<x>, payload)` method. Do not expose
     `ipcRenderer` itself. For main→renderer pushes, add an `IpcEvents` entry
     and a `subscribe()` accessor (the `ALLOWED_EVENTS` set gates it).
4. **Tests**: add a registry-level unit test (zod rejects bad payload) and, for
   engine-adjacent ops, an integration test with real mongod
   (`tests/integration/fixtures/global-setup.ts` + `useMongoIntegrationSuite()`).
   Engine behavior changes require BOTH (AGENTS.md testing conventions).

## Template

```ts
// src/shared/ipc/index.ts
export const IpcChannels = { /* … */ myThingDo: 'mongog:my-thing:do' };
export const myThingDoSchema = z.object({ connectionId: z.string().min(1) }).strict();
export type MyThingDoResult = { ok: true };

// src/main/ipc/handlers.ts
registerChannel(
  IpcChannels.myThingDo,
  myThingDoSchema,
  async ({ connectionId }) => myService.do(connectionId),
  validateSender,
);

// src/preload/preload.ts
myThing: { do: (connectionId: string) => invoke(IpcChannels.myThingDo, { connectionId }) },
```

## Anti-patterns (will fail review / CI)

- New channel string used in renderer without an `IpcChannels` entry.
- `ipcMain.handle` called directly instead of `registerChannel` (skips zod +
  sender check + `AppError` envelope).
- Loose schema (`z.any()`, non-strict object accepting secrets).
- Raw `Error` with connection string in message; missing `redactUri`/`redactForLog`.
- Preload exposing generic `invoke(channel, …)` or `ipcRenderer`.
- Renderer importing anything from `src/main` or `src/query-runtime`.
