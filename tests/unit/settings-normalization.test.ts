import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeApplicationSettings,
} from '../../src/shared/domain/workspace.js';

describe('application settings normalization', () => {
  it('defaults new and missing settings to MongoDB Shell display', () => {
    expect(DEFAULT_SETTINGS.ejson.defaultMode).toBe('mongosh');
    expect(normalizeApplicationSettings(undefined).ejson.defaultMode).toBe('mongosh');
    expect(normalizeApplicationSettings({ theme: 'dark' }).ejson.defaultMode).toBe('mongosh');
    expect(DEFAULT_SETTINGS.collection).toEqual({
      defaultView: 'documents',
      autoExecuteDefaultQuery: false,
    });
    expect(DEFAULT_SETTINGS.execution.pageSize).toBe(50);
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
    expect(settings.ejson.defaultMode).toBe('mongosh');
  });

  it('preserves valid collection defaults and disables auto-run for Documents', () => {
    expect(normalizeApplicationSettings({
      collection: { defaultView: 'query', autoExecuteDefaultQuery: true },
    }).collection).toEqual({ defaultView: 'query', autoExecuteDefaultQuery: true });

    expect(normalizeApplicationSettings({
      collection: { defaultView: 'documents', autoExecuteDefaultQuery: true },
    }).collection).toEqual({ defaultView: 'documents', autoExecuteDefaultQuery: false });
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
});
