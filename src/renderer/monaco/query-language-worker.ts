/** Query-only virtual source. The editor model and saved source stay untouched. */
import { TypeScriptWorker, initialize } from 'monaco-editor/language/typescript/ts.worker.js';
import { buildAutoAwaitProjection, mapAutoAwaitResult, type AutoAwaitProjection } from '../../features/script-analysis/auto-await-projection.js';

const positionMethods = new Set([
  'getCompletionsAtPosition', 'getCompletionEntryDetails', 'getSignatureHelpItems',
  'getQuickInfoAtPosition', 'getDocumentHighlights', 'getDefinitionAtPosition',
  'getReferencesAtPosition', 'findRenameLocations', 'getRenameInfo',
]);
const rawMethods = new Set([
  'getFormattingEditsForDocument', 'getFormattingEditsForRange', 'getFormattingEditsAfterKeystroke',
  'getCodeFixesAtPosition', 'getEmitOutput',
]);
const mappedMethods = new Set([
  ...positionMethods, 'getSyntacticDiagnostics', 'getSemanticDiagnostics',
  'getSuggestionDiagnostics', 'getNavigationTree', 'provideInlayHints',
]);

class QueryLanguageWorker extends TypeScriptWorker {
  private projections = new Map<string, { version: string; value: AutoAwaitProjection }>();

  constructor(context: unknown, data: unknown) {
    super(context, data);
    // Use a separate unprojected host for formatting/code actions. Such edits
    // must never copy generated helper text into the user's document.
    const rawWorker = new TypeScriptWorker(context, data);
    const service = this._languageService;
    this._languageService = new Proxy(service, {
      get: (target, key) => {
        const member = Reflect.get(target, key);
        if (typeof member !== 'function') return member;
        const method = String(key);
        return (...input: unknown[]) => {
          const fileName = typeof input[0] === 'string' ? input[0] : '';
          const projection = this.projection(fileName);
          if (!projection || (!mappedMethods.has(method) && !rawMethods.has(method))) return Reflect.apply(member, target, input);
          if (rawMethods.has(method)) {
            // The normal worker's language service is exposed by Monaco.
            const rawService = (rawWorker as unknown as { getLanguageService(): typeof service }).getLanguageService();
            return Reflect.apply(Reflect.get(rawService, key), rawService, input);
          }
          const args = [...input];
          if (positionMethods.has(method) && typeof args[1] === 'number') {
            const caret = method === 'getCompletionsAtPosition' || method === 'getCompletionEntryDetails' || method === 'getSignatureHelpItems';
            args[1] = caret ? projection.toGenerated(args[1]) : projection.toGenerated(args[1] + 1) - 1;
          }
          if (method === 'provideInlayHints') {
            const span = args[1] as { start: number; length: number };
            const start = projection.toGenerated(span.start);
            args[1] = { start, length: projection.toGenerated(span.start + span.length) - start };
          }
          const mapped = this.mapResult(Reflect.apply(member, target, args), fileName);
          return mapped ?? (method === 'getRenameInfo' ? {canRename:false,localizedErrorMessage:'Generated code cannot be renamed'} : undefined);
        };
      },
    });
  }

  private projection(fileName: string): AutoAwaitProjection | undefined {
    if (!fileName.startsWith('mongog-query:')) return undefined;
    const version = this.getScriptVersion(fileName);
    const cached = this.projections.get(fileName);
    if (cached?.version === version) return cached.value;
    const source = this._getScriptText(fileName);
    if (source === undefined) { this.projections.delete(fileName); return undefined; }
    const value = buildAutoAwaitProjection(source);
    // Bound stale models retained while switching/closing tabs.
    if (this.projections.size > 64) this.projections.clear();
    this.projections.set(fileName, { version, value });
    return value;
  }

  override getScriptSnapshot(fileName: string) {
    const projection = this.projection(fileName);
    if (!projection) return super.getScriptSnapshot(fileName);
    return { getText: (start: number, end: number) => projection.source.slice(start, end),
      getLength: () => projection.source.length, getChangeRange: () => undefined };
  }

  private mapResult(value: unknown, fileName: string): unknown {
    return mapAutoAwaitResult(value, fileName, name => this.projection(name));
  }
}

self.onmessage = () => initialize((context, data) => new QueryLanguageWorker(context, data));
