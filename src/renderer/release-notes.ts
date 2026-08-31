export type ReleaseNoteSectionKind = 'added' | 'improved' | 'fixed';

export interface ReleaseNoteSection {
  kind: ReleaseNoteSectionKind;
  items: readonly string[];
}

export interface ReleaseNote {
  version: string;
  releasedAt: string;
  title: string;
  summary: string;
  sections: readonly ReleaseNoteSection[];
}

/**
 * Bundled, offline release history. Add every new release at the beginning and
 * keep RELEASE_NOTES ordered newest-first.
 */
export const RELEASE_NOTES = [
  {
    version: '1.2.9',
    releasedAt: '2026-08-31',
    title: 'Smarter Documents column filters',
    summary: 'Write column filters with syntax highlighting and suggestions for operators and nested field names.',
    sections: [
      {
        kind: 'added',
        items: [
          'Documents column filters now highlight operators, nested selectors, strings, numbers and BSON values in light and dark themes.',
          'Autocomplete suggests filter operators and schema field names inside object and array selectors without suggesting document values.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Use Ctrl+Space to open suggestions, Up/Down to navigate, Enter or Tab to select, and Escape to dismiss. Enter applies the filter when suggestions are closed.',
          'Compact column inputs preserve native selection, undo and IME input, with operator suggestions available even when schema sampling fails.',
        ],
      },
    ],
  },
  {
    version: '1.2.8',
    releasedAt: '2026-08-31',
    title: 'Reliable update downloads',
    summary: 'Fixes missing update configuration in macOS and Linux packages so available updates can be downloaded.',
    sections: [
      {
        kind: 'fixed',
        items: [
          'Fixed the missing app-update.yml error when clicking Download now on macOS and Linux.',
          'Incomplete update configuration now reports clear reinstall instructions before a download is attempted.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Release packages are checked for update configuration before distribution, and automated tests exercise real downloads and checksum failures.',
          'Existing installations affected by the missing-file error need a one-time manual reinstall; saved connections and workspace data are preserved.',
        ],
      },
    ],
  },
  {
    version: '1.2.7',
    releasedAt: '2026-08-31',
    title: 'Automatic await and Query preferences',
    summary: 'Write queries without await, personalize the Query editor and choose how the Documents criteria panel opens.',
    sections: [
      {
        kind: 'added',
        items: [
          'Query and Trusted Script modes now wait for database results automatically, including helper functions, conditions and sequential array callbacks.',
          'Query editor settings now include an 8–72 px font size and optional Cmd/Ctrl + mouse wheel zoom, saved across restarts.',
          'Choose whether the Documents criteria panel opens by default in new and restored tabs; existing tabs keep your manual choice.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Explicit await and Promise combinators remain supported, while for...of can iterate cursors without changing interactive result paging.',
          'Query completions and error markers understand automatically resolved results without changing editor text, saved scripts or history.',
          'Font changes update open Query editors without resetting content, selection or undo history, and leave Documents editors and results unchanged.',
          'Cancellation tracks outstanding parallel operations until they settle, and contexts that cannot wait report explanatory errors.',
        ],
      },
    ],
  },
  {
    version: '1.2.6',
    releasedAt: '2026-08-29',
    title: 'Verified native updates',
    summary: 'MongoG uses verified automatic updates where packages can be authenticated and a safe manual flow elsewhere.',
    sections: [
      {
        kind: 'added',
        items: [
          'Automatic update feeds now publish signed macOS packages and an RPM package with SHA-512 verification.',
          'Windows ships as an explicitly unsigned NSIS installer with manual updates, avoiding an unauthenticated automatic-update path.',
          'Update downloads require explicit consent, and restart remains a separate choice after verification finishes.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'macOS updates select the correct arm64 or x64 ZIP while Linux uses its supported RPM package.',
          'Development, portable and unsigned Windows packages report automatic updates as unsupported instead of attempting an invalid update.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Fixed update feed paths, missing checksums, duplicate checks and stale event listeners that could break production updates.',
        ],
      },
    ],
  },
  {
    version: '1.2.5',
    releasedAt: '2026-08-24',
    title: 'Trusted macOS downloads',
    summary: 'MongoG macOS release packages are now signed, notarized and delivered directly through CircleCI.',
    sections: [
      {
        kind: 'improved',
        items: [
          'macOS release applications and installers are signed with Apple Developer ID and notarized by Apple.',
          'CircleCI exposes signed arm64 and x64 ZIP and DMG packages directly from each release job.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Downloaded macOS builds no longer appear as damaged because of an invalid ad-hoc signature.',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    releasedAt: '2026-08-14',
    title: 'Responsive, dependable cancellation',
    summary: 'Documents and Query workflows now communicate progress clearly and stop long-running MongoDB work reliably.',
    sections: [
      {
        kind: 'added',
        items: [
          'Documents and Query result areas now show an immediate loading overlay with operation context and a Cancel action.',
          'Document refreshes and pagination can now be cancelled at the MongoDB driver level.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Cancelling a fetch preserves the visible page, ignores late responses and closes cursors that can no longer be resumed.',
          'Query cancellation now waits for the real driver operation to settle and automatically reconnects only when a stuck runtime must be stopped.',
          'Runtime restarts close stale cursors and Change Streams while keeping completed result pages visible for review.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Fixed Query Cancel reporting success while the underlying MongoDB operation continued running in the background.',
          'Cancellation outcomes no longer appear as red query errors, and stale pagination responses cannot replace the current view.',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    releasedAt: '2026-08-12',
    title: 'A more adaptable workspace',
    summary: 'MongoG becomes easier to personalize, navigate and understand across longer desktop sessions.',
    sections: [
      {
        kind: 'added',
        items: [
          'A built-in, offline Release Notes workspace with the complete MongoG release history.',
          'A global table column-order preference for alphabetical or database document order.',
          'A global idle-disconnect preference ranging from 15 minutes to Never.',
          'A resizable sidebar that remembers its preferred width and adapts to smaller windows.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Tabs now use a dedicated drag grip, a reliable selection surface and an always-visible close button.',
          'Manual Documents column order stays with the open tab while Query Results react immediately to the global preference.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'macOS credential storage now handles keychain-backed encryption more reliably without exposing plaintext secrets.',
        ],
      },
    ],
  },
  {
    version: '1.0.4',
    releasedAt: '2026-08-10',
    title: 'Reliable macOS packaging',
    summary: 'The unsigned macOS release pipeline became more resilient when creating distributable disk images.',
    sections: [{
      kind: 'fixed',
      items: ['Stabilized DMG creation and cleanup when a previous volume mount is missing or already detached.'],
    }],
  },
  {
    version: '1.0.3',
    releasedAt: '2026-08-09',
    title: 'Full-width query results',
    summary: 'Query result tables now use the complete available workspace width for compact result sets.',
    sections: [{
      kind: 'fixed',
      items: ['Removed unused horizontal space after the final Query Results column across supported platforms.'],
    }],
  },
  {
    version: '1.0.2',
    releasedAt: '2026-08-09',
    title: 'Cross-platform release validation',
    summary: 'Release verification became consistent across macOS, Windows and Linux runners.',
    sections: [{
      kind: 'improved',
      items: ['Hardened package verification arguments and cross-platform release checks.'],
    }],
  },
  {
    version: '1.0.1',
    releasedAt: '2026-08-09',
    title: 'Stable packaged interactions',
    summary: 'Packaged application testing became more reliable for resizable workspace surfaces.',
    sections: [{
      kind: 'improved',
      items: ['Stabilized document-panel resize interactions in packaged Electron validation.'],
    }],
  },
  {
    version: '1.0.0',
    releasedAt: '2026-08-09',
    title: 'The first MongoG desktop release',
    summary: 'A secure, cross-platform MongoDB desktop IDE with query, document, administration and data movement workflows.',
    sections: [
      {
        kind: 'added',
        items: [
          'Welcome and Connections experiences with encrypted credential storage and typed connection testing.',
          'Hybrid Documents and Query collection tabs with Monaco editing, BSON-aware results and advanced criteria filters.',
          'Hierarchical Saved Queries, Document Views and Tab templates under each connection.',
          'Global search, indexes, explain, Change Streams, GridFS and MongoDB Activity Log workspaces.',
          'Streaming Excel, CSV and TXT export plus CSV/XLSX import and safe connection-to-connection copy.',
          'Theme-aware MongoG branding and unsigned packages for macOS, Windows and Linux.',
        ],
      },
    ],
  },
] as const satisfies readonly ReleaseNote[];

export const LATEST_RELEASE = RELEASE_NOTES[0];
