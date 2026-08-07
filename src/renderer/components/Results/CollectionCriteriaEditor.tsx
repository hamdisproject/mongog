import { useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import {
  DocumentExpressionError,
  parseDocumentExpression,
} from '../../../features/script-analysis/index.js';
import {
  OBJECT_EXPRESSION_LANGUAGE,
  registerObjectExpressionModel,
  type CriteriaKind,
} from '../../monaco/object-expression.js';
import { bootMonaco } from '../../monaco/setup.js';
import { theme } from '../../theme.js';

interface CollectionCriteriaEditorProps {
  tabId: string;
  kind: CriteriaKind;
  label: string;
  value: string;
  connectionId: string;
  database: string;
  collection: string;
  placeholder: string;
  onChange: (value: string) => void;
  onApply: () => void;
  onValidationChange: (kind: CriteriaKind, message: string | null) => void;
}

const styles: Record<string, React.CSSProperties> = {
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  label: { color: theme.colors.textMuted, fontSize: 11, fontWeight: 600 },
  shell: {
    display: 'block', position: 'relative', overflow: 'hidden',
    border: `1px solid ${theme.colors.borderStrong}`, borderRadius: theme.radius,
    background: theme.colors.input, cursor: 'text', transition: 'height 80ms ease-out',
  },
  host: { width: '100%' },
  placeholder: {
    position: 'absolute', left: 11, top: 8, color: theme.colors.textFaint,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
    pointerEvents: 'none', zIndex: 1,
  },
};

const MIN_EDITOR_HEIGHT = 34;
const MAX_EDITOR_HEIGHT = 168;

export function CollectionCriteriaEditor({
  tabId,
  kind,
  label,
  value,
  connectionId,
  database,
  collection,
  placeholder,
  onChange,
  onApply,
  onValidationChange,
}: CollectionCriteriaEditorProps) {
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onApplyRef = useRef(onApply);
  const validationRef = useRef(onValidationChange);

  valueRef.current = value;
  onChangeRef.current = onChange;
  onApplyRef.current = onApply;
  validationRef.current = onValidationChange;

  useEffect(() => {
    let disposed = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let model: Monaco.editor.ITextModel | null = null;
    let contextRegistration: Monaco.IDisposable | null = null;
    let changeRegistration: Monaco.IDisposable | null = null;
    let contentSizeRegistration: Monaco.IDisposable | null = null;

    void bootMonaco().then((monaco) => {
      if (disposed || !hostRef.current) return;
      const uri = monaco.Uri.parse(
        `${OBJECT_EXPRESSION_LANGUAGE}://criteria/${encodeURIComponent(tabId)}/${kind}`,
      );
      model = monaco.editor.createModel(valueRef.current, OBJECT_EXPRESSION_LANGUAGE, uri);
      contextRegistration = registerObjectExpressionModel(model, {
        connectionId,
        database,
        collection,
        kind,
      });
      editor = monaco.editor.create(hostRef.current, {
        model,
        theme: 'vs-dark',
        ariaLabel: `Collection ${kind}`,
        automaticLayout: true,
        minimap: { enabled: false },
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 8,
        lineNumbersMinChars: 0,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: 'none',
        scrollBeyondLastLine: false,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'hidden',
          verticalScrollbarSize: 7,
          horizontalScrollbarSize: 0,
          alwaysConsumeMouseWheel: false,
        },
        fontSize: 12,
        lineHeight: 18,
        wordWrap: 'on',
        fixedOverflowWidgets: true,
        bracketPairColorization: { enabled: true },
        padding: { top: 6, bottom: 6 },
      });
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => onApplyRef.current(),
      );
      changeRegistration = model.onDidChangeContent(() => {
        const next = model!.getValue();
        onChangeRef.current(next);
        validateModel(monaco, model!, kind, validationRef.current);
      });
      const updateEditorHeight = () => {
        const contentHeight = editor!.getContentHeight();
        setEditorHeight(Math.max(
          MIN_EDITOR_HEIGHT,
          Math.min(MAX_EDITOR_HEIGHT, contentHeight),
        ));
      };
      contentSizeRegistration = editor.onDidContentSizeChange(updateEditorHeight);
      modelRef.current = model;
      editorRef.current = editor;
      validateModel(monaco, model, kind, validationRef.current);
      updateEditorHeight();
    });

    return () => {
      disposed = true;
      contentSizeRegistration?.dispose();
      changeRegistration?.dispose();
      contextRegistration?.dispose();
      editor?.dispose();
      model?.dispose();
      modelRef.current = null;
      editorRef.current = null;
    };
  }, [collection, connectionId, database, kind, tabId]);

  useEffect(() => {
    const model = modelRef.current;
    if (model && model.getValue() !== value) model.setValue(value);
  }, [value]);

  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      <span
        data-testid={`criteria-editor-${kind}`}
        style={{ ...styles.shell, height: editorHeight }}
        onClick={() => editorRef.current?.focus()}
      >
        {!value && <span style={styles.placeholder}>{placeholder}</span>}
        <div ref={hostRef} style={{ ...styles.host, height: editorHeight }} />
      </span>
    </label>
  );
}

function validateModel(
  monaco: typeof import('monaco-editor'),
  model: Monaco.editor.ITextModel,
  kind: CriteriaKind,
  onValidationChange: (kind: CriteriaKind, message: string | null) => void,
): void {
  const source = model.getValue();
  if (!source.trim() && kind !== 'filter') {
    monaco.editor.setModelMarkers(model, OBJECT_EXPRESSION_LANGUAGE, []);
    onValidationChange(kind, null);
    return;
  }

  try {
    parseDocumentExpression(source, criteriaLabel(kind));
    monaco.editor.setModelMarkers(model, OBJECT_EXPRESSION_LANGUAGE, []);
    onValidationChange(kind, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const startOffset = error instanceof DocumentExpressionError
      ? Math.min(source.length, error.start)
      : 0;
    const endOffset = error instanceof DocumentExpressionError
      ? Math.min(source.length, Math.max(error.start + 1, error.end))
      : Math.min(source.length, 1);
    const start = model.getPositionAt(startOffset);
    const end = model.getPositionAt(endOffset);
    monaco.editor.setModelMarkers(model, OBJECT_EXPRESSION_LANGUAGE, [{
      severity: monaco.MarkerSeverity.Error,
      message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: endOffset === startOffset ? start.column + 1 : end.column,
    }]);
    onValidationChange(kind, message);
  }
}

function criteriaLabel(kind: CriteriaKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
