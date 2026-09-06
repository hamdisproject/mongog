import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  effectiveSidebarWidth,
  normalizeSidebarWidth,
  sidebarMaximumForViewport,
} from '../../../src/shared/domain/workspace.js';
import { workspaceSaveSchema } from '../../../src/shared/ipc/index.js';

describe('sidebar layout', () => {
  it('normalizes persisted and legacy widths', () => {
    expect(normalizeSidebarWidth(180)).toBe(180);
    expect(normalizeSidebarWidth(520)).toBe(520);
    expect(normalizeSidebarWidth(undefined)).toBe(260);
    expect(normalizeSidebarWidth(179)).toBe(260);
    expect(normalizeSidebarWidth(521)).toBe(260);
    expect(normalizeSidebarWidth(260.5)).toBe(260);
  });

  it('reserves workspace width while respecting the sidebar bounds', () => {
    expect(sidebarMaximumForViewport(700)).toBe(180);
    expect(sidebarMaximumForViewport(900)).toBe(280);
    expect(sidebarMaximumForViewport(984)).toBe(364);
    expect(sidebarMaximumForViewport(1_000)).toBe(380);
    expect(sidebarMaximumForViewport(1_440)).toBe(520);
    expect(effectiveSidebarWidth(500, 900)).toBe(280);
    expect(effectiveSidebarWidth(500, 1_440)).toBe(500);
  });

  it('clamps pointer and keyboard resize values', () => {
    expect(clampSidebarWidth(120)).toBe(180);
    expect(clampSidebarWidth(700)).toBe(520);
    expect(clampSidebarWidth(350.6)).toBe(351);
    expect(clampSidebarWidth(500, 900)).toBe(280);
  });

  it('validates persisted sidebar width at the IPC boundary', () => {
    const payload = (sidebarWidth: number) => ({
      state: { sidebarWidth, tabs: [], activeTabId: null },
    });
    expect(workspaceSaveSchema.safeParse(payload(180)).success).toBe(true);
    expect(workspaceSaveSchema.safeParse(payload(520)).success).toBe(true);
    expect(workspaceSaveSchema.safeParse(payload(179)).success).toBe(false);
    expect(workspaceSaveSchema.safeParse(payload(521)).success).toBe(false);
    expect(workspaceSaveSchema.safeParse(payload(260.5)).success).toBe(false);
  });
});
