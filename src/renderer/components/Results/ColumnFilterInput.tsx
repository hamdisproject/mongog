import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { columnFilterHelpText } from '../../collection-column-filter.js';
import {
  completeColumnFilter,
  tokenizeColumnFilter,
  type ColumnFilterSuggestion,
} from '../../column-filter-language.js';
import { schemaCacheKey, useSchemaCache } from '../../stores/schema-cache.js';

interface ColumnFilterInputProps {
  connectionId: string;
  database: string;
  collection: string;
  column: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onApply: () => void;
}

interface CompletionRequest {
  source: string;
  caret: number;
  manual: boolean;
}

/** Native editing/undo with a non-interactive, scroll-synchronized syntax layer. */
export const ColumnFilterInput = memo(function ColumnFilterInput({
  connectionId, database, collection, column, value, error, onChange, onApply,
}: ColumnFilterInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const insertingRef = useRef(false);
  const insertChangedRef = useRef(false);
  const [composing, setComposing] = useState(false);
  const [request, setRequest] = useState<CompletionRequest | null>(null);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 280, maxHeight: 240 });
  const listId = useId();
  const helpId = useId();
  const key = schemaCacheKey(connectionId, database, collection);
  const snapshot = useSchemaCache((state) => state.cache[key]);
  const tokens = useMemo(() => tokenizeColumnFilter(value), [value]);
  const suggestions = useMemo(() => request && request.source === value
    ? completeColumnFilter(value, request.caret, column, snapshot?.fields, request.manual)
    : [], [column, request, snapshot, value]);
  const open = suggestions.length > 0;
  const selectedIndex = Math.min(active, suggestions.length - 1);

  const syncScroll = useCallback(() => {
    const align = () => {
      if (textRef.current && inputRef.current) {
        // A second scroll container can clamp/round differently from a native
        // input. Translate by its actual offset, including fractional pixels.
        textRef.current.style.transform = `translateX(${-inputRef.current.scrollLeft}px)`;
      }
    };
    align();
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    // Native caret scrolling may finish after React's change/selection event.
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      align();
    });
  }, []);
  useLayoutEffect(syncScroll, [value, composing, syncScroll]);
  useEffect(() => {
    const observer = new ResizeObserver(syncScroll);
    if (inputRef.current) observer.observe(inputRef.current);
    return () => {
      observer.disconnect();
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, [syncScroll]);

  useEffect(() => {
    setRequest(null);
  }, [connectionId, database, collection, column]);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const table = input.closest('table')?.parentElement?.getBoundingClientRect();
      if (rect.width === 0 || (table && (rect.right < table.left || rect.left > table.right))) {
        setRequest(null);
        return;
      }
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const upward = below < 160 && above > below;
      const maxHeight = Math.max(0, Math.min(240, upward ? above : below));
      const height = Math.min(popupRef.current?.scrollHeight ?? 240, maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upward ? rect.top - height - 4 : rect.bottom + 4,
        width, maxHeight,
      });
    };
    const onScroll = (event: Event) => {
      if (!popupRef.current?.contains(event.target as Node)) reposition();
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    if (inputRef.current) observer.observe(inputRef.current);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', onScroll, true);
    const close = () => setRequest(null);
    window.addEventListener('blur', close);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', close);
    };
  }, [open, suggestions.length]);

  useEffect(() => {
    if (open) popupRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedIndex]);

  const updateSuggestions = (input: HTMLInputElement, manual = false) => {
    if (composingRef.current || insertingRef.current || input.selectionStart !== input.selectionEnd) {
      setRequest(null);
      return;
    }
    setActive(0);
    setRequest({ source: input.value, caret: input.selectionStart ?? input.value.length, manual });
  };

  const accept = (suggestion: ColumnFilterSuggestion) => {
    const input = inputRef.current;
    if (!input || !request || request.source !== input.value) return;
    insertingRef.current = true;
    insertChangedRef.current = false;
    input.focus();
    input.setSelectionRange(suggestion.start, suggestion.end);
    // Chromium's native insertText editing command preserves the input's undo stack.
    // The payload is plain text; it is never interpreted as markup or executable code.
    const inserted = document.execCommand('insertText', false, suggestion.insertText);
    if (!inserted) input.setRangeText(suggestion.insertText, suggestion.start, suggestion.end, 'end');
    if (!insertChangedRef.current) onChange(input.value);
    const caret = suggestion.start + suggestion.insertText.length;
    input.setSelectionRange(caret, caret);
    insertingRef.current = false;
    setRequest(null);
    syncScroll();
  };

  return (
    <div
      className={`column-filter-input${composing ? ' is-composing' : ''}`}
      data-column-filter={column}
      data-invalid={error ? 'true' : undefined}
      onDragStart={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="column-filter-paint" aria-hidden="true">
        <div className="column-filter-text" ref={textRef}>
          {tokens.map((token) => (
            <span
              key={token.start}
              data-filter-token={token.kind}
              style={{ color: token.kind === 'plain' ? undefined
                : `var(--color-syntax-${token.kind === 'regexp' ? 'string' : token.kind})` }}
            >{token.text}</span>
          ))}
        </div>
      </div>
      <input
        ref={inputRef}
        aria-label={`Filter ${column} column`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${selectedIndex}` : undefined}
        aria-describedby={helpId}
        aria-invalid={error ? 'true' : undefined}
        title={error ?? columnFilterHelpText()}
        value={value}
        draggable={false}
        autoComplete="off"
        spellCheck={false}
        placeholder="exact, {field}: value, [{field}]: value"
        onFocus={() => {
          syncScroll();
          void useSchemaCache.getState().loadSchema(connectionId, database, collection).catch(() => undefined);
        }}
        onBlur={() => { setRequest(null); syncScroll(); }}
        onScroll={syncScroll}
        onKeyUp={syncScroll}
        onPointerUp={syncScroll}
        onSelect={(event) => {
          syncScroll();
          if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) setRequest(null);
        }}
        onClick={(event) => { if (open) updateSuggestions(event.currentTarget); }}
        onChange={(event) => {
          insertChangedRef.current = insertingRef.current;
          onChange(event.target.value);
          if (!insertingRef.current) updateSuggestions(event.currentTarget);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          setComposing(true);
          setRequest(null);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          setComposing(false);
          updateSuggestions(event.currentTarget);
        }}
        onKeyDown={(event) => {
          syncScroll();
          if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.ctrlKey && event.code === 'Space') {
            event.preventDefault();
            updateSuggestions(event.currentTarget, true);
          } else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setActive((selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
          } else if (open && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
            event.preventDefault();
            accept(suggestions[selectedIndex]!);
          } else if (event.key === 'Escape') {
            if (open) event.preventDefault();
            setRequest(null);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            onApply();
          } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab'].includes(event.key) || event.metaKey || event.ctrlKey) {
            setRequest(null);
          }
        }}
      />
      <span id={helpId} className="column-filter-a11y-help">
        {error ?? 'Ctrl+Space for suggestions. Up/Down to navigate, Enter or Tab to choose, Escape to dismiss. Enter applies when suggestions are closed.'}
      </span>
      {open && createPortal(
        <div
          ref={popupRef}
          id={listId}
          role="listbox"
          aria-label={`Suggestions for ${column}`}
          className="column-filter-suggestions"
          style={position}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={`${suggestion.kind}:${suggestion.label}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              className="column-filter-suggestion"
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => accept(suggestion)}
            >
              <span className="column-filter-suggestion-label" data-kind={suggestion.kind}>{suggestion.label}</span>
              <span className="column-filter-suggestion-detail">{suggestion.detail}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
});
