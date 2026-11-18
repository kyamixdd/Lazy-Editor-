import React from 'react';
import { Search, X } from 'lucide-react';

interface GlassSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rightSlot?: React.ReactNode;
}

export const GlassSearchBar: React.FC<GlassSearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search projects, templates, exports...',
  className = '',
  rightSlot,
}) => {
  return (
    <div
      className={`glass-level-3 border rounded-2xl px-3.5 min-h-[46px] flex items-center gap-2.5 focus-within:border-blue-500/60 transition-colors ${className}`}
    >
      <Search className="w-4 h-4 text-slate-400 shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full min-h-[40px] bg-transparent text-sm tablet:text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {rightSlot}
    </div>
  );
};
