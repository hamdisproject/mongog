import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { bulkFieldPathSuggestions } from '../../collection-workspace.js';

interface BulkFieldPathComboboxProps {
  id: string;
  columns: string[];
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}

export function BulkFieldPathCombobox({
  id,
  columns,
  value,
  disabled,
  invalid,
  onChange,
}: BulkFieldPathComboboxProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = useMemo(
    () => bulkFieldPathSuggestions(columns, filterQuery ?? ''),
    [columns, filterQuery],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (activeIndex < suggestions.length) return;
    setActiveIndex(suggestions.length > 0 ? suggestions.length - 1 : -1);
  }, [activeIndex, suggestions.length]);

  const openAll = () => {
    if (disabled) return;
    setFilterQuery(null);
    setActiveIndex(-1);
    setOpen(true);
  };

  const choose = (field: string) => {
    onChange(field);
    setFilterQuery(null);
    setActiveIndex(-1);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="bulk-field-combobox">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-label="Bulk update field path"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0
          ? `${listId}-${activeIndex}`
          : undefined}
        aria-invalid={invalid || undefined}
        className="bulk-field-combobox-input"
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          if (!open) openAll();
        }}
        onClick={() => {
          if (!open) openAll();
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setFilterQuery(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              openAll();
              setActiveIndex(event.key === 'ArrowDown' ? 0 : Math.max(0, suggestions.length - 1));
              return;
            }
            if (suggestions.length === 0) return;
            setActiveIndex((current) => {
              if (event.key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % suggestions.length;
              return current < 0 ? suggestions.length - 1 : (current - 1 + suggestions.length) % suggestions.length;
            });
          } else if (event.key === 'Enter' && open && activeIndex >= 0 && suggestions[activeIndex]) {
            event.preventDefault();
            choose(suggestions[activeIndex]);
          } else if (event.key === 'Escape') {
            if (open) event.preventDefault();
            setOpen(false);
          } else if (event.key === 'Tab') {
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="bulk-field-combobox-toggle"
        aria-label="Show bulk update fields"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openAll();
            inputRef.current?.focus();
          }
        }}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Bulk update fields"
          className="bulk-field-combobox-options"
        >
          {suggestions.length > 0 ? suggestions.map((field, index) => (
            <div
              key={field}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className="bulk-field-combobox-option"
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(field)}
            >
              {field}
            </div>
          )) : (
            <div className="bulk-field-combobox-empty" role="status">
              No visible editable fields. Type a field path.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
