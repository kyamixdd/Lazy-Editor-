import React, { useId } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { MOTION_DURATION, MOTION_SPRING } from '../../config/motionSystem';

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
  const groupId = useId();
  const prefersReduced = useReducedMotion();

  return (
    <LayoutGroup id={`seg-${groupId}`}>
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
              className={`relative min-h-[38px] tablet:min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap touch-manipulation transition-colors duration-150 flex items-center gap-1.5 ${
                active
                  ? 'text-white dark:text-[#050505]'
                  : 'text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId={`seg-pill-${groupId}`}
                  transition={
                    prefersReduced
                      ? { duration: MOTION_DURATION.instant }
                      : MOTION_SPRING.nav
                  }
                  className="absolute inset-0 rounded-lg bg-[#101010] dark:bg-white shadow-sm border border-black/15 dark:border-white/30"
                  aria-hidden="true"
                />
              )}
              <span className="relative z-10">{opt.label}</span>
              {typeof opt.count === 'number' && (
                <span className="relative z-10 text-[11px] opacity-70 tabular-nums">
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
