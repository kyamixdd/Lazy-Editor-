import React, { useEffect, useState } from 'react';
import {
  NumericCommitOptions,
  parseCommittedNumericDraft,
} from '../utils/editorInteractions';

interface NumericDraftInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'
  > {
  value: number;
  fallback?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  decimals?: number;
  allowZero?: boolean;
  onCommit: (next: number) => void;
  commitOptions?: NumericCommitOptions;
  /** Optional display formatter when unfocused (defaults to String(value)). */
  formatValue?: (val: number) => string;
}

export const NumericDraftInput: React.FC<NumericDraftInputProps> = ({
  value,
  fallback,
  min,
  max,
  integer,
  decimals,
  allowZero,
  onCommit,
  commitOptions,
  formatValue,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}) => {
  const formatted = formatValue ? formatValue(value) : String(value);
  const [draft, setDraft] = useState<string>(formatted);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatted);
    }
  }, [formatted, focused]);

  const effectiveOptions: NumericCommitOptions = {
    min,
    max,
    integer,
    decimals,
    allowZero,
    ...commitOptions,
  };

  const commitDraft = () => {
    const fallbackVal = fallback ?? value;
    const parsed = parseCommittedNumericDraft(draft, fallbackVal, effectiveOptions);
    if (parsed !== value) {
      onCommit(parsed);
    }
    setDraft(formatValue ? formatValue(parsed) : String(parsed));
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={focused ? draft : formatted}
      onFocus={(e) => {
        setFocused(true);
        setDraft(formatted);
        onFocus?.(e);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={(e) => {
        setFocused(false);
        commitDraft();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitDraft();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(formatted);
          setFocused(false);
          e.currentTarget.blur();
        }
        onKeyDown?.(e);
      }}
    />
  );
};
