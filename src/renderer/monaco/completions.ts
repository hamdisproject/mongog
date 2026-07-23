import * as monaco from 'monaco-editor';
import { useSchemaCache } from '../stores/schema-cache.js';
import { useEditorContext } from '../stores/editor-context.js';

const FIELD_KIND = monaco.languages.CompletionItemKind.Field;
const METHOD_KIND = monaco.languages.CompletionItemKind.Method;

const COLLECTION_METHODS = [
  { label: 'find', insertText: 'find({})', detail: 'cursor' },
  { label: 'findOne', insertText: 'findOne({})', detail: 'document | null' },
  { label: 'insertOne', insertText: 'insertOne({})', detail: 'InsertOneResult' },
  { label: 'insertMany', insertText: 'insertMany([])', detail: 'InsertManyResult' },
  { label: 'updateOne', insertText: 'updateOne({}, {})', detail: 'UpdateResult' },
  { label: 'updateMany', insertText: 'updateMany({}, {})', detail: 'UpdateResult' },
  { label: 'deleteOne', insertText: 'deleteOne({})', detail: 'DeleteResult' },
  { label: 'deleteMany', insertText: 'deleteMany({})', detail: 'DeleteResult' },
  { label: 'replaceOne', insertText: 'replaceOne({}, {})', detail: 'UpdateResult' },
  { label: 'aggregate', insertText: 'aggregate([])', detail: 'AggregationCursor' },
  { label: 'countDocuments', insertText: 'countDocuments({})', detail: 'number' },
  { label: 'estimatedDocumentCount', insertText: 'estimatedDocumentCount()', detail: 'number' },
  { label: 'distinct', insertText: 'distinct("field")', detail: 'Array' },
  { label: 'findOneAndUpdate', insertText: 'findOneAndUpdate({}, {})', detail: 'document | null' },
  { label: 'findOneAndDelete', insertText: 'findOneAndDelete({})', detail: 'document | null' },
  { label: 'findOneAndReplace', insertText: 'findOneAndReplace({}, {})', detail: 'document | null' },
  { label: 'bulkWrite', insertText: 'bulkWrite([])', detail: 'BulkWriteResult' },
  { label: 'createIndex', insertText: 'createIndex({})', detail: 'string' },
  { label: 'createIndexes', insertText: 'createIndexes([])', detail: 'Array<string>' },
  { label: 'drop', insertText: 'drop()', detail: 'boolean' },
  { label: 'rename', insertText: 'rename("newName")', detail: 'Coll' },
  { label: 'indexes', insertText: 'indexes()', detail: 'Array' },
  { label: 'indexExists', insertText: 'indexExists("idx")', detail: 'boolean' },
  { label: 'totalSize', insertText: 'totalSize()', detail: 'number' },
  { label: 'stats', insertText: 'stats()', detail: 'object' },
  { label: 'watch', insertText: 'watch()', detail: 'ChangeStream' },
];

const CURSOR_METHODS = [
  { label: 'toArray', insertText: 'toArray()', detail: 'Array' },
  { label: 'next', insertText: 'next()', detail: 'document | null' },
  { label: 'hasNext', insertText: 'hasNext()', detail: 'boolean' },
  { label: 'forEach', insertText: 'forEach(fn)', detail: 'void' },
  { label: 'map', insertText: 'map(fn)', detail: 'Array' },
  { label: 'sort', insertText: 'sort({})', detail: 'Cursor' },
  { label: 'limit', insertText: 'limit(n)', detail: 'Cursor' },
  { label: 'skip', insertText: 'skip(n)', detail: 'Cursor' },
  { label: 'project', insertText: 'project({})', detail: 'Cursor' },
  { label: 'count', insertText: 'count()', detail: 'number' },
  { label: 'close', insertText: 'close()', detail: 'void' },
  { label: 'explain', insertText: 'explain()', detail: 'document' },
  { label: 'hint', insertText: 'hint({})', detail: 'Cursor' },
  { label: 'collation', insertText: 'collation({})', detail: 'Cursor' },
  { label: 'maxAwaitTimeMS', insertText: 'maxAwaitTimeMS(n)', detail: 'Cursor' },
  { label: 'maxTimeMS', insertText: 'maxTimeMS(n)', detail: 'Cursor' },
  { label: 'batchSize', insertText: 'batchSize(n)', detail: 'Cursor' },
  { label: 'comment', insertText: 'comment("text")', detail: 'Cursor' },
];

export function registerSchemaCompletions(): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('typescript', {
    triggerCharacters: ['.', '"', "'", '(', ','],

    provideCompletionItems: (model, position) => {
      const textUntil = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const wordInfo = model.getWordUntilPosition(position);
      const currentWord = wordInfo.word;
      const fullText = model.getValue();

      const items: monaco.languages.CompletionItem[] = [];
      const isAfterDot = textUntil.trimEnd().endsWith('.');

      // ── Collection context: db.collection("name"). or variable named after collection ──
      const collCtx = detectCollectionContext(fullText, position.lineNumber, isAfterDot);
      if (collCtx) {
        const { connectionId, database, collection } = collCtx;

        // Schema field completions.
        const schema = useSchemaCache.getState().getSchema(connectionId, database, collection);
        if (schema) {
          for (const f of schema.fields) {
            const primaryType = f.types[0]?.bsonType ?? 'unknown';
            items.push({
              label: f.path,
              kind: FIELD_KIND,
              detail: `${primaryType} (${(f.presence * 100).toFixed(0)}%)`,
              insertText: f.path.includes('.') ? `"${f.path}"` : f.path,
              range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: wordInfo.startColumn, endColumn: wordInfo.endColumn },
              sortText: `a${Math.round((1 - f.presence) * 100).toString().padStart(3, '0')}-${f.path}`,
            } satisfies monaco.languages.CompletionItem);
          }
        } else {
          void useSchemaCache.getState().loadSchema(connectionId, database, collection);
        }

        // Collection method completions.
        for (const m of COLLECTION_METHODS) {
          items.push({
            label: m.label,
            kind: METHOD_KIND,
            detail: m.detail,
            insertText: m.insertText,
            range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: wordInfo.startColumn, endColumn: wordInfo.endColumn },
          });
        }
      }

      // ── Cursor context: .after variable that looks like a cursor ──
      if (isAfterDot && isLikelyCursor(fullText, currentWord, position.lineNumber)) {
        for (const m of CURSOR_METHODS) {
          items.push({
            label: m.label,
            kind: METHOD_KIND,
            detail: m.detail,
            insertText: m.insertText,
            range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: wordInfo.startColumn, endColumn: wordInfo.endColumn },
          });
        }
      }

      return { suggestions: items };
    },
  });
}

interface CollectionContext {
  connectionId: string;
  database: string;
  collection: string;
}

function detectCollectionContext(fullText: string, lineNumber: number, isAfterDot: boolean): CollectionContext | null {
  if (!isAfterDot) return null;

  const { connectionId, database } = useEditorContext.getState();
  if (!connectionId) return null;

  const lines = fullText.split('\n');
  const beforeCursor = lines.slice(0, lineNumber).join('\n');

  // Pattern 1: db.collection("name").
  const directMatch = beforeCursor.match(/db\.collection\(\s*["']([^"']+)["']\s*\)\.\s*$/m);
  if (directMatch?.[1]) {
    return { connectionId, database: database ?? 'admin', collection: directMatch[1] };
  }

  // Pattern 2: variable = db.collection("name") then variable.
  const linesBeforeCursor = beforeCursor.split('\n');
  for (let i = linesBeforeCursor.length - 1; i >= 0; i--) {
    const line = linesBeforeCursor[i]!;
    const varMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*db\.collection\(\s*["']([^"']+)["']\s*\)/);
    if (varMatch) {
      const varName = varMatch[1]!;
      const collName = varMatch[2]!;
      // Check if the line before the cursor ends with variableName.
      const lineAtCursor = lines[lineNumber - 1] ?? '';
      if (lineAtCursor.trimEnd().endsWith(`${varName}.`)) {
        return { connectionId, database: database ?? 'admin', collection: collName };
      }
    }
  }

  return null;
}

function isLikelyCursor(fullText: string, currentWord: string, lineNumber: number): boolean {
  if (currentWord === 'cursor') return true;

  const lines = fullText.split('\n');
  for (let i = Math.min(lineNumber, lines.length) - 1; i >= 0; i--) {
    const line = lines[i]!;
    const m = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:db\.collection|db\.)/);
    if (m?.[1] === currentWord) return false;
  }

  return false;
}
