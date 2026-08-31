declare module 'monaco-editor/language/typescript/ts.worker.js' {
  import type ts from 'typescript';
  export class TypeScriptWorker {
    constructor(context: unknown, data: unknown);
    protected _languageService: ts.LanguageService;
    _getScriptText(fileName: string): string | undefined;
    getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined;
    getScriptVersion(fileName: string): string;
  }
  export function initialize(factory: (context: unknown, data: unknown) => unknown): void;
}
