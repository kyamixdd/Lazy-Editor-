import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

export type SheetSnapState = 'compact' | 'medium' | 'expanded';

interface GlassBottomSheetProps {
  isOpen: boolean;
  snapState?: SheetSnapState;
  onSnapChange?: (next: SheetSnapState) => void;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  allowBackdropPassthrough?: boolean;
  children: React.ReactNode;
}

const SNAP_HEIGHT_CLASS: Record<SheetSnapState, string> = {
  compact: 'h-[28dvh] min-h-[190px]',
  medium: 'h-[54dvh] min-h-[320px]',
  expanded: 'h-[88dvh]',
};

export const GlassBottomSheet: React.FC<GlassBottomSheetProps> = ({
  isOpen,
  snapState = 'medium',
  onSnapChange,
  onClose,
  title,
  subtitle,
  headerRight,
  allowBackdropPassthrough = false,
  children,
}) => {
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const cycleSnap = () => {
    if (!onSnapChange) return;
    if (snapState === 'compact') onSnapChange('medium');
    else if (snapState === 'medium') onSnapChange('expanded');
    else onSnapChange('compact');
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (dragStartYRef.current === null) return;
    const endY = e.changedTouches[0]?.clientY ?? dragStartYRef.current;
    const dy = endY - dragStartYRef.current;
    dragStartYRef.current = null;
    if (Math.abs(dy) < 32) return;
    if (dy < 0) {
      // Swipe up -> expand
      if (snapState === 'compact') onSnapChange?.('medium');
      else if (snapState === 'medium') onSnapChange?.('expanded');
    } else {
      // Swipe down -> shrink or close
      if (snapState === 'expanded') onSnapChange?.('medium');
      else if (snapState === 'medium') onSnapChange?.('compact');
      else onClose();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-end ${
        allowBackdropPassthrough ? 'pointer-events-none' : ''
      }`}
    >
      {!allowBackdropPassthrough && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/35 dark:bg-black/50 backdrop-blur-[2px] transition-opacity"
        />
      )}

      <div
        role="dialog"
        aria-modal={!allowBackdropPassthrough}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={`pointer-events-auto relative z-10 w-full max-w-2xl mx-auto rounded-t-3xl border border-b-0 glass-level-4 glass-sheet-transition flex flex-col overflow-hidden pb-safe ${SNAP_HEIGHT_CLASS[snapState]}`}
      >
        {/* Drag Handle & Header */}
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="px-4 pt-2.5 pb-2 border-b border-slate-200/70 dark:border-white/10 shrink-0 select-none"
        >
          <button
            type="button"
            onClick={cycleSnap}
            aria-label="Cycle sheet height"
            className="mx-auto mb-2 w-11 h-1.5 rounded-full bg-slate-400/50 dark:bg-slate-500/60 block hover:bg-blue-500/70 transition-colors"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {title && (
                <div className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {title}
                </div>
              )}
              {subtitle && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {subtitle}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {headerRight}
              {onSnapChange && (
                <button
                  type="button"
                  onClick={() =>
                    onSnapChange(snapState === 'expanded' ? 'medium' : 'expanded')
                  }
                  aria-label={
                    snapState === 'expanded' ? 'Shrink sheet' : 'Expand sheet'
                  }
                  className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/50 dark:hover:bg-white/10"
                >
                  {snapState === 'expanded' ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/50 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Sheet Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
};
