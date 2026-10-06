/**
 * CSOT budget for paged cursors.
 *
 * With `timeoutMS`, the driver defaults non-tailable cursors to the
 * `cursorLifetime` mode: one deadline for the whole cursor, and a server-side
 * `maxTimeMS` that is cumulative across getMore. A result the user pages
 * through later therefore fails once that budget has elapsed, even though each
 * page is fast. Interactive paging needs the `iteration` mode instead: every
 * `next()` gets the full budget again and the initial command omits
 * `maxTimeMS`, exactly as the driver configures it for `timeoutMode: 'iteration'`.
 *
 * User scripts create these cursors, so the mode cannot be passed as an option.
 * It is switched here before the first command; the integration suite pins the
 * driver internals this relies on.
 */
import * as mongodb from 'mongodb';

interface DriverCursorTimeoutState {
  initialized?: boolean;
  cursorOptions?: {
    timeoutMS?: number;
    timeoutMode?: string;
    tailable?: boolean;
    omitMaxTimeMS?: boolean;
  };
}

/** Returns true when the cursor now uses a per-page (per-iteration) budget. */
export function usePerPageTimeout(cursor: unknown): boolean {
  if (!(cursor instanceof mongodb.AbstractCursor)) return false;
  const state = cursor as unknown as DriverCursorTimeoutState;
  const options = state.cursorOptions;
  if (state.initialized || !options || options.tailable) return false;
  if (!options.timeoutMS || options.timeoutMode !== mongodb.CursorTimeoutMode.LIFETIME) return false;

  options.timeoutMode = mongodb.CursorTimeoutMode.ITERATION;
  options.omitMaxTimeMS = true;
  return true;
}
