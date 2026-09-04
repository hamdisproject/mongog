import { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import {
  DocumentExpressionError,
  parseDocumentArrayExpression,
  parseDocumentExpression,
  parseValueExpression,
} from '../../../features/script-analysis/index.js';
import { OBJECT_EXPRESSION_LANGUAGE } from '../../monaco/object-expression.js';
import { bootMonaco } from '../../monaco/setup.js';
import { getMonacoTheme } from '../../theme.js';

interface DocumentBsonEditorProps {
  tabId: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onValidationChange: (message: string | null) => void;
  validationKind?: 'document' | 'document-array' | 'value';
  ariaLabel?: string;
}

export function DocumentBsonEditor({
  tabId,
  value,
  readOnly,
  onChange,
  onSave,
  onValidationChange,
  validationKind = 'document',
  ariaLabel = 'Document BSON editor',
}: DocumentBsonEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const valueRef = useRef(value);
  const readOnlyRef = useRef(readOnly);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const validationRef = useRef(onValidationChange);

  valueRef.current = value;
  readOnlyRef.current = readOnly;
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  validationRef.current = onValidationChange;

  useEffect(() => {
    let disposed = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let model: Monaco.editor.ITextModel | null = null;
    let changeRegistration: Monaco.IDisposable | null = null;

    void bootMonaco().then((monaco) => {
      if (disposed || !hostRef.current) return;
      model = monaco.editor.createModel(
        valueRef.current,
        OBJECT_EXPRESSION_LANGUAGE,
        monaco.Uri.parse(`${OBJECT_EXPRESSION_LANGUAGE}://${validationKind}/${encodeURIComponent(tabId)}`),
      );
      editor = monaco.editor.create(hostRef.current, {
        model,
        theme: getMonacoTheme(),
        ariaLabel,
        automaticLayout: true,
        readOnly: readOnlyRef.current,
        minimap: { enabled: false },
        fontSize: 12,
        lineHeight: 18,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: true,
        bracketPairColorization: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        fixedOverflowWidgets: true,
        padding: { top: 8, bottom: 8 },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (!readOnlyRef.current) onSaveRef.current();
      });
      changeRegistration = model.onDidChangeContent(() => {
        const next = model!.getValue();
        onChangeRef.current(next);
        validateDocumentModel(monaco, model!, validationRef.current, readOnlyRef.current, validationKind);
      });
      modelRef.current = model;
      editorRef.current = editor;
      validateDocumentModel(monaco, model, validationRef.current, readOnlyRef.current, validationKind);
    });

    return () => {
      disposed = true;
      changeRegistration?.dispose();
      editor?.dispose();
      model?.dispose();
      modelRef.current = null;
      editorRef.current = null;
    };
  }, [ariaLabel, tabId, validationKind]);

  useEffect(() => {
    const model = modelRef.current;
    if (model && model.getValue() !== value) model.setValue(value);
  }, [value]);

  useEffect(() => {
    readOnlyRef.current = readOnly;
    editorRef.current?.updateOptions({ readOnly });
    void bootMonaco().then((monaco) => {
      const model = modelRef.current;
      if (model) validateDocumentModel(monaco, model, validationRef.current, readOnly, validationKind);
    });
  }, [readOnly, validationKind]);

  return <div data-testid="document-bson-editor" ref={hostRef} style={{ flex: 1, minHeight: 0 }} />;
}

function validateDocumentModel(
  monaco: typeof import('monaco-editor'),
  model: Monaco.editor.ITextModel,
  onValidationChange: (message: string | null) => void,
  readOnly: boolean,
  validationKind: 'document' | 'document-array' | 'value',
): void {
  if (readOnly) {
    monaco.editor.setModelMarkers(model, OBJECT_EXPRESSION_LANGUAGE, []);
    onValidationChange(null);
    return;
  }
  const source = model.getValue();
  try {
    if (validationKind === 'document-array') parseDocumentArrayExpression(source, 'Documents');
    else if (validationKind === 'value') parseValueExpression(source, 'Field value');
    else parseDocumentExpression(source, 'Document');
    monaco.editor.setModelMarkers(model, OBJECT_EXPRESSION_LANGUAGE, []);
    onValidationChange(null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const startOffset = error instanceof DocumentExpressionError ? error.start : 0;
    const endOffset = error instanceof DocumentExpressionError ? error.end : Math.min(1, source.length);
    const start = model.getPositionAt(Math.min(source.length, startOffset));
    const end = model.getPositionAt(Math.min(source.length, Math.max(startOffset + 1, endOffset)));
    monaco.editor.setModelMarkers(model, OBJECT_EXPRESSION_LANGUAGE, [{
      severity: monaco.MarkerSeverity.Error,
      message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    }]);
    onValidationChange(message);
  }
}
