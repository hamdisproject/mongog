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
    version: '1.2.23',
    releasedAt: '2026-09-13',
    title: 'Faster, more reliable updates and complete 1.2.22 fixes',
    summary: 'Update checks and reporting are more resilient, with general performance and stability improvements plus every user-facing improvement from 1.2.22.',
    sections: [
      {
        kind: 'added',
        items: [
          'Update requests now use a random installation identifier that survives normal app updates and restarts, improving anonymous device-level update reporting without hardware fingerprints or account data.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Improved performance and stability across update checks, downloads, and operational reporting.',
          'Documents and query-result tables show Not Set only when a field is absent, while explicitly stored null values remain null.',
          'Windows application, taskbar, Start menu, installer, and uninstaller surfaces use the same larger multi-resolution icon.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'ObjectId values entered in the document editor are inserted as real BSON ObjectIds instead of strings.',
          'Editing a document preserves supported BSON types and prevents the immutable _id field from being removed or changed.',
          'Update identity persistence failures no longer create unstable per-launch identifiers; update checks continue anonymously.',
        ],
      },
    ],
  },
  {
    version: '1.2.22',
    releasedAt: '2026-09-08',
    title: 'Lossless BSON editing and clearer table values',
    summary: 'BSON values now keep their intended types through document editing, while missing fields and Windows icons are easier to recognize.',
    sections: [
      {
        kind: 'improved',
        items: [
          'Documents and query-result tables now show Not Set only when a field is absent, while explicitly stored null values remain null.',
          'Windows application, taskbar, Start menu, installer, and uninstaller surfaces now use the same larger multi-resolution icon.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'ObjectId values entered in the document editor are inserted as real BSON ObjectIds instead of strings.',
          'Editing a document preserves supported BSON types and prevents the immutable _id field from being removed or changed.',
        ],
      },
    ],
  },
  {
    version: '1.2.21',
    releasedAt: '2026-09-05',
    title: 'Faster GitHub Actions releases',
    summary: 'Production packages now build once in parallel on GitHub Actions and arrive in a verified draft release.',
    sections: [
      {
        kind: 'improved',
        items: [
          'macOS ARM64 and x64, Windows x64, and Linux x64 production packages now build in parallel through GitHub Actions.',
          'Each production package is built once, with platform and architecture download caches reducing repeated release work.',
          'Windows now checks for new versions without downloading or installing them in-app, and links to mongog.com/releases for manual installation.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Release assets, checksums, and updater manifests are verified together before a draft GitHub Release is created.',
        ],
      },
    ],
  },
  {
    version: '1.2.20',
    releasedAt: '2026-09-05',
    title: 'Reliable reconnects and cross-platform release checks',
    summary: 'Connection discovery, context menus, and tab scrollbar validation now behave consistently across Windows, Linux, and macOS.',
    sections: [
      {
        kind: 'fixed',
        items: [
          'Explorer profiles now expand and reload their database list after a query cancellation restarts the connection runtime.',
          'Context menus now register Escape dismissal before the menu is painted, preventing a stale menu from blocking the next action.',
          'Tab scrollbar track-click validation now targets the exposed track reliably across different platform viewport widths.',
        ],
      },
    ],
  },
  {
    version: '1.2.19',
    releasedAt: '2026-09-04',
    title: 'Explicit connections and discoverable bulk fields',
    summary: 'Connect only when you intend to, choose bulk-update fields from the table or type a new path, copy results, and navigate crowded workspaces smoothly.',
    sections: [
      {
        kind: 'added',
        items: [
          'Select individual documents or the current page, then update a shared field, unset a field, or edit complete documents in one BSON-aware bulk workflow.',
          'Delete selected documents with a mandatory confirmation and per-document optimistic concurrency checks.',
          'Choose a visible table column from the bulk-update field dropdown or type a new field path directly in the same editable combobox.',
          'Copy each statement result in the active BSON display format, including the currently loaded document page, scalar values, writes, commands, errors, and stream summaries.',
          'Copy all query console output in the active BSON display format with a one-click action and confirmation toast.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Crowded workspace tab bars now use a 4 px theme-aware custom scrollbar that appears immediately on hover or keyboard focus while keeping Query, Search, and Transfer actions fixed.',
          'The tab scrollbar supports thumb dragging, track clicks, mouse-wheel and trackpad input, plus Arrow, Home, and End keyboard controls.',
          'Opening or activating a tab automatically reveals it without disturbing pinned and regular tab ordering.',
          'Hovering the tab strip highlights its scrollbar, and vertical mouse-wheel movement scrolls overflowing tabs horizontally.',
          'Visible console output remains selectable as text in addition to the one-click Copy action.',
          'Connection rows no longer connect or disconnect when clicked or double-clicked; only the explicit Connect and Disconnect controls change connection state.',
          'Successfully connected profiles now expand automatically and begin loading their databases.',
          'Bulk operations validate every input before writing, continue through stale, missing, or driver failures, and reselect visible failed documents after refresh.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Windows release validation now accepts native CRLF clipboard line endings without changing the copied console content.',
          'Linux release jobs now avoid the unreliable EC2 Ubuntu mirror and bound dependency downloads with retries and timeouts.',
          'Linux packaging now retries once from clean output if Electron Forge returns without producing an executable or RPM.',
        ],
      },
    ],
  },
  {
    version: '1.2.13',
    releasedAt: '2026-09-01',
    title: 'Windows updates and sharper platform icons',
    summary: 'Windows can download verified updates in the background, while refreshed package icons keep MongoG clear and consistent.',
    sections: [
      {
        kind: 'added',
        items: [
          'Windows updates now download automatically and wait for an explicit Restart & Install action before changing the installed application.',
          'Update download and ready-to-install states remain visible in the sidebar and Updates view.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Windows application, taskbar, installer and uninstaller icons now use crisp DPI-specific MongoG artwork from 16 to 256 pixels.',
          'The macOS disk image now uses the MongoG volume icon instead of the Electron default.',
          'Windows installation requests elevation only when the existing per-user installation location requires additional permission.',
        ],
      },
      {
        kind: 'fixed',
        items: [
          'Windows release metadata now includes the updater manifest and SHA-512 details required for verified in-app downloads.',
        ],
      },
    ],
  },
  {
    version: '1.2.12',
    releasedAt: '2026-09-01',
    title: 'Clearer Documents table controls',
    summary: 'Documents keeps active sort fields visible and separates column dragging from filtering and criteria actions.',
    sections: [
      {
        kind: 'fixed',
        items: [
          'Active top-level sort fields remain visible as table columns when the current documents or projection omit them, including their direction and priority.',
          'Column filter inputs no longer initiate column reordering because dragging starts only from the dedicated header grip.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Column drag grips appear on hover or focus, reserve stable header space, and keep sorting and resizing as separate controls.',
          'Refresh now sits beside Clear and Apply in the Documents Criteria action group.',
        ],
      },
    ],
  },
  {
    version: '1.2.11',
    releasedAt: '2026-08-31',
    title: 'Column filter text alignment',
    summary: 'Documents column filters keep highlighted text aligned with native input scrolling across editing and resizing.',
    sections: [
      {
        kind: 'fixed',
        items: [
          'Highlighted filter text follows the native input scroll offset without a separate scrollbar rounding or clamping its position.',
          'Caret movement, typing, focus changes and column resizing also synchronize the highlight layer after native scrolling completes.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Release checks exercise long filters, caret navigation and resizing, and report individual layout measurements when alignment fails.',
        ],
      },
    ],
  },
  {
    version: '1.2.10',
    releasedAt: '2026-08-31',
    title: 'Reliable Windows release setup',
    summary: 'Windows release builds no longer depend on the Chocolatey package feed, and regular CI avoids duplicate package builds.',
    sections: [
      {
        kind: 'fixed',
        items: [
          'Windows x64 builds install Python directly from the official offline installer, verify download checksums and retry temporary download failures.',
          'Failed installations and unexpected Python versions or architectures stop the build before native dependencies are compiled.',
        ],
      },
      {
        kind: 'improved',
        items: [
          'Standalone smoke package builds are disabled for branch pushes; release E2E, package verification and production smoke checks remain enabled.',
        ],
      },
    ],
  },
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
