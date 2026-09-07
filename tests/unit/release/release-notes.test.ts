import { describe, expect, it } from 'vitest';
import packageMetadata from '../../../package.json';
import { LATEST_RELEASE, RELEASE_NOTES } from '../../../src/renderer/release-notes.js';

describe('bundled release notes', () => {
  it('matches the application package version', () => {
    expect(LATEST_RELEASE.version).toBe(packageMetadata.version);
  });

  it('contains unique semantic versions in newest-first order', () => {
    const versions = RELEASE_NOTES.map((release) => release.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toContain('1.0.0');
    for (const version of versions) expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect([...versions].sort(compareSemverDescending)).toEqual(versions);
  });

  it('provides dated, categorized content for every release', () => {
    for (const release of RELEASE_NOTES) {
      expect(release.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(release.title.trim()).not.toBe('');
      expect(release.summary.trim()).not.toBe('');
      expect(release.sections.length).toBeGreaterThan(0);
      expect(release.sections.every((section) => section.items.length > 0)).toBe(true);
    }
  });
});

function compareSemverDescending(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
