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
