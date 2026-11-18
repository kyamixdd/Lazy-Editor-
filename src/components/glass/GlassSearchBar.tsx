import React from 'react';
import { Search, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MOTION_DURATION, MOTION_EASE, MOTION_SPRING } from '../../config/motionSystem';

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
  const prefersReduced = useReducedMotion();

  return (
    <div
      className={`glass-level-3 border rounded-2xl px-3.5 min-h-[46px] flex items-center gap-2.5 focus-within:border-black/35 dark:focus-within:border-white/35 focus-within:shadow-[0_10px_28px_-12px_rgba(0,0,0,0.18)] dark:focus-within:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.65)] transition-[border-color,box-shadow,background-color] duration-200 ${className}`}
    >
      <Search className="w-4 h-4 text-[#888888] dark:text-[#858585] shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full min-h-[40px] bg-transparent text-sm tablet:text-xs text-[#101010] dark:text-white placeholder:text-[#888888] dark:placeholder:text-[#858585] focus:outline-none"
      />
      <AnimatePresence initial={false}>
        {value && (
          <motion.button
            key="clear-search"
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            whileTap={!prefersReduced ? { scale: 0.9 } : undefined}
            transition={
              prefersReduced
                ? { duration: MOTION_DURATION.instant }
                : MOTION_SPRING.snappy
            }
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white transition-colors"
            style={{ transitionTimingFunction: `cubic-bezier(${MOTION_EASE.liquid.join(',')})` }}
          >
            <X className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
      {rightSlot}
    </div>
  );
};
