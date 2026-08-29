import { describe, expect, it } from 'vitest';
import {
  CONNECTION_IDLE_TIMEOUT_VALUES,
  DEFAULT_CONNECTION_IDLE_TIMEOUT_MS,
  DEFAULT_SETTINGS,
  normalizeApplicationSettings,
} from '../../src/shared/domain/workspace.js';
import { applicationSettingsSchema } from '../../src/shared/ipc/index.js';

describe('application settings normalization', () => {
  it('defaults new and missing settings to MongoDB Shell display', () => {
    expect(DEFAULT_SETTINGS.ejson.defaultMode).toBe('mongosh');
    expect(normalizeApplicationSettings(undefined).ejson.defaultMode).toBe('mongosh');
    expect(normalizeApplicationSettings({ theme: 'dark' }).ejson.defaultMode).toBe('mongosh');
    expect(DEFAULT_SETTINGS.collection).toEqual({
      defaultView: 'documents',
      autoExecuteDefaultQuery: false,
      explorerOpenBehavior: 'reuse-existing',
    });
    expect(DEFAULT_SETTINGS.execution.pageSize).toBe(50);
    expect(DEFAULT_SETTINGS.table).toEqual({ columnOrder: 'alphabetical' });
    expect(DEFAULT_SETTINGS.connection.idleTimeoutMS).toBe(3_600_000);
    expect(normalizeApplicationSettings({ theme: 'light' }).connection.idleTimeoutMS)
      .toBe(DEFAULT_CONNECTION_IDLE_TIMEOUT_MS);
  });

  it.each(['relaxed', 'canonical', 'mongosh'] as const)('preserves the valid %s preference', (mode) => {
    expect(normalizeApplicationSettings({ ejson: { defaultMode: mode } }).ejson.defaultMode).toBe(mode);
  });

  it('repairs corrupt nested values while retaining valid legacy fields', () => {
    const settings = normalizeApplicationSettings({
      theme: 'light',
      editor: { fontSize: 'large', tabSize: 4, wordWrap: true },
      execution: { pageSize: -1, confirmDestructive: false },
      history: null,
      table: { columnOrder: 'unknown' },
      ejson: { defaultMode: 'broken' },
    });
    expect(settings.theme).toBe('light');
    expect(settings.editor).toEqual({
      ...DEFAULT_SETTINGS.editor,
      tabSize: 4,
      wordWrap: true,
    });
    expect(settings.execution.pageSize).toBe(DEFAULT_SETTINGS.execution.pageSize);
    expect(settings.execution.confirmDestructive).toBe(false);
    expect(settings.history).toEqual(DEFAULT_SETTINGS.history);
    expect(settings.audit).toEqual(DEFAULT_SETTINGS.audit);
    expect(settings.collection).toEqual(DEFAULT_SETTINGS.collection);
    expect(settings.table).toEqual(DEFAULT_SETTINGS.table);
    expect(settings.ejson.defaultMode).toBe('mongosh');
  });

  it.each(['alphabetical', 'document'] as const)('preserves the valid %s table column order', (columnOrder) => {
    expect(normalizeApplicationSettings({ table: { columnOrder } }).table.columnOrder).toBe(columnOrder);
  });

  it('defaults and rejects an unsupported table column order', () => {
    expect(normalizeApplicationSettings({ table: { columnOrder: 'server' } }).table)
      .toEqual({ columnOrder: 'alphabetical' });
    expect(applicationSettingsSchema.safeParse({
      ...structuredClone(DEFAULT_SETTINGS),
      table: { columnOrder: 'server' },
    }).success).toBe(false);
  });

  it('preserves valid collection defaults and disables auto-run for Documents', () => {
    expect(normalizeApplicationSettings({
      collection: { defaultView: 'query', autoExecuteDefaultQuery: true },
    }).collection).toEqual({
      defaultView: 'query',
      autoExecuteDefaultQuery: true,
      explorerOpenBehavior: 'reuse-existing',
    });

    expect(normalizeApplicationSettings({
      collection: { defaultView: 'documents', autoExecuteDefaultQuery: true },
    }).collection).toEqual({
      defaultView: 'documents',
      autoExecuteDefaultQuery: false,
      explorerOpenBehavior: 'reuse-existing',
    });
  });

  it.each(['reuse-existing', 'new-tab'] as const)(
    'preserves the valid %s Explorer collection behavior',
    (explorerOpenBehavior) => {
      expect(normalizeApplicationSettings({ collection: { explorerOpenBehavior } }).collection.explorerOpenBehavior)
        .toBe(explorerOpenBehavior);
    },
  );

  it('defaults and rejects an unsupported Explorer collection behavior', () => {
    expect(normalizeApplicationSettings({
      collection: { explorerOpenBehavior: 'replace-active' },
    }).collection.explorerOpenBehavior).toBe('reuse-existing');
    expect(applicationSettingsSchema.safeParse({
      ...structuredClone(DEFAULT_SETTINGS),
      collection: {
        ...DEFAULT_SETTINGS.collection,
        explorerOpenBehavior: 'replace-active',
      },
    }).success).toBe(false);
  });

  it('accepts only page sizes from 1 through 500', () => {
    expect(normalizeApplicationSettings({ execution: { pageSize: 1 } }).execution.pageSize).toBe(1);
    expect(normalizeApplicationSettings({ execution: { pageSize: 500 } }).execution.pageSize).toBe(500);
    expect(normalizeApplicationSettings({ execution: { pageSize: 0 } }).execution.pageSize).toBe(50);
    expect(normalizeApplicationSettings({ execution: { pageSize: 501 } }).execution.pageSize).toBe(50);
    expect(normalizeApplicationSettings({ execution: { pageSize: 12.5 } }).execution.pageSize).toBe(50);
  });

  it('preserves and bounds the local audit retention policy', () => {
    expect(normalizeApplicationSettings({ audit: { retentionDays: 30, maxEntries: 2_500 } }).audit)
      .toEqual({ retentionDays: 30, maxEntries: 2_500 });
    expect(normalizeApplicationSettings({ audit: { retentionDays: 0, maxEntries: 20 } }).audit)
      .toEqual(DEFAULT_SETTINGS.audit);
  });

  it.each(CONNECTION_IDLE_TIMEOUT_VALUES)('preserves supported connection idle timeout %i', (idleTimeoutMS) => {
    expect(normalizeApplicationSettings({ connection: { idleTimeoutMS } }).connection.idleTimeoutMS)
      .toBe(idleTimeoutMS);
  });

  it('repairs invalid idle timeouts and rejects them at the IPC boundary', () => {
    for (const idleTimeoutMS of [-1, 1, 12.5, 86_400_000, 'never', null]) {
      expect(normalizeApplicationSettings({ connection: { idleTimeoutMS } }).connection.idleTimeoutMS)
        .toBe(DEFAULT_CONNECTION_IDLE_TIMEOUT_MS);
      expect(applicationSettingsSchema.safeParse({
        ...structuredClone(DEFAULT_SETTINGS),
        connection: { idleTimeoutMS },
      }).success).toBe(false);
    }
  });
});
