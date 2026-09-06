import { describe, expect, it } from 'vitest';
import { attachQueryWheelZoom } from '../../../src/renderer/monaco/query-wheel-zoom.js';

function setup(isMac = true) {
  const host = new EventTarget() as HTMLElement;
  Object.defineProperty(host, 'clientHeight', { value: 400 });
  const preferences = { fontSize: 13, enabled: true };
  const dispose = attachQueryWheelZoom(host, {
    isMac,
    getPreferences: () => preferences,
    setFontSize: (fontSize) => { preferences.fontSize = fontSize; },
  });
  const wheel = (overrides: Partial<WheelEvent> = {}) => {
    const event = new Event('wheel', { cancelable: true });
    for (const [key, value] of Object.entries({
      deltaY: -120, deltaMode: 0, metaKey: isMac, ctrlKey: !isMac,
      altKey: false, shiftKey: false, timeStamp: 10, ...overrides,
    })) Object.defineProperty(event, key, { value });
    host.dispatchEvent(event);
    return event;
  };
  return { preferences, wheel, dispose };
}

describe('Query wheel zoom', () => {
  it.each([true, false])('zooms with the platform modifier (macOS: %s) and respects limits', (isMac) => {
    const { preferences, wheel } = setup(isMac);
    expect(wheel().defaultPrevented).toBe(true);
    expect(preferences.fontSize).toBe(14);
    wheel({ deltaY: 120 });
    expect(preferences.fontSize).toBe(13);
    preferences.fontSize = 72;
    wheel();
    expect(preferences.fontSize).toBe(72);
    preferences.fontSize = 8;
    wheel({ deltaY: 120 });
    expect(preferences.fontSize).toBe(8);
  });

  it('leaves normal scroll and other modifier combinations alone', () => {
    const { preferences, wheel } = setup();
    for (const modifiers of [
      { metaKey: false }, { ctrlKey: true, metaKey: false }, { altKey: true }, { shiftKey: true },
    ]) expect(wheel(modifiers).defaultPrevented).toBe(false);
    expect(preferences.fontSize).toBe(13);
  });

  it('disables font and browser zoom immediately, and removes its listener on disposal', () => {
    const { preferences, wheel, dispose } = setup();
    preferences.enabled = false;
    expect(wheel().defaultPrevented).toBe(true);
    expect(preferences.fontSize).toBe(13);
    preferences.enabled = true;
    wheel();
    expect(preferences.fontSize).toBe(14);
    dispose();
    expect(wheel().defaultPrevented).toBe(false);
    expect(preferences.fontSize).toBe(14);
  });

  it('accumulates fine trackpad movement and normalizes line/page wheel deltas', () => {
    const { preferences, wheel } = setup();
    wheel({ deltaY: -10 });
    wheel({ deltaY: -10, timeStamp: 20 });
    wheel({ deltaY: -10, timeStamp: 30 });
    expect(preferences.fontSize).toBe(13);
    wheel({ deltaY: -10, timeStamp: 40 });
    expect(preferences.fontSize).toBe(14);
    wheel({ deltaY: 3, deltaMode: 1 });
    expect(preferences.fontSize).toBe(13);
    wheel({ deltaY: -1, deltaMode: 2 });
    expect(preferences.fontSize).toBe(14);
    wheel({ deltaY: -20 });
    wheel({ deltaY: -20, timeStamp: 1000 });
    expect(preferences.fontSize).toBe(14);
  });
});
