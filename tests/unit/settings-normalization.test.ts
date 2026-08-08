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
    expect(settings.ejson.defaultMode).toBe('mongosh');
  });
});
