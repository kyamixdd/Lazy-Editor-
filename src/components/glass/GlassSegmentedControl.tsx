import React from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface GlassSegmentedControlProps<T extends string> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}

export function GlassSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: GlassSegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 p-1 rounded-xl glass-level-2 border overflow-x-auto max-w-full no-scrollbar ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`min-h-[38px] tablet:min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap touch-manipulation transition-[background-color,color,box-shadow] duration-150 flex items-center gap-1.5 ${
              active
                ? 'bg-white dark:bg-white/14 text-slate-900 dark:text-white shadow-sm border border-slate-200/80 dark:border-white/15'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
            }`}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span className="text-[11px] opacity-70 tabular-nums">
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
