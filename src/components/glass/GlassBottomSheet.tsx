import React, { useEffect } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from 'motion/react';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING,
} from '../../config/motionSystem';

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

const SNAP_HEIGHT_DVH: Record<SheetSnapState, string> = {
  compact: '28dvh',
  medium: '54dvh',
  expanded: '88dvh',
};

const SNAP_MIN_HEIGHT: Record<SheetSnapState, string> = {
  compact: '190px',
  medium: '320px',
  expanded: '360px',
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
  const prefersReduced = useReducedMotion();
  const dragControls = useDragControls();
  const dragY = useMotionValue(0);
  const backdropOpacityFactor = useTransform(dragY, [0, 260], [1, 0.2]);

  useEffect(() => {
    if (!isOpen) return;
    dragY.set(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, dragY]);

  const cycleSnap = () => {
    if (!onSnapChange) return;
    if (snapState === 'compact') onSnapChange('medium');
    else if (snapState === 'medium') onSnapChange('expanded');
    else onSnapChange('compact');
  };

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const dy = info.offset.y;
    const vy = info.velocity.y;

    if (vy > 520 || (dy > 130 && !onSnapChange)) {
      onClose();
      return;
    }

    if (vy < -320 || dy < -56) {
      if (snapState === 'compact') onSnapChange?.('medium');
      else if (snapState === 'medium') onSnapChange?.('expanded');
    } else if (vy > 280 || dy > 56) {
      if (snapState === 'expanded') {
        if (vy > 680 || dy > 220) {
          onClose();
        } else {
          onSnapChange?.('medium');
        }
      } else if (snapState === 'medium') {
        if (onSnapChange && dy < 160 && vy < 520) {
          onSnapChange('compact');
        } else {
          onClose();
        }
      } else {
        onClose();
      }
    }

    dragY.set(0);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className={`fixed inset-0 z-50 flex flex-col justify-end ${
            allowBackdropPassthrough ? 'pointer-events-none' : ''
          }`}
        >
          {!allowBackdropPassthrough && (
            <motion.div
              key="sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                pointerEvents: 'none',
                transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
              }}
              transition={{ duration: MOTION_DURATION.fast }}
              style={{ opacity: backdropOpacityFactor }}
              onClick={onClose}
              className="fixed inset-0 bg-black/35 dark:bg-black/65 backdrop-blur-[2px]"
            />
          )}

          <motion.div
            key="sheet-surface"
            role="dialog"
            aria-modal={!allowBackdropPassthrough}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            drag={prefersReduced ? false : 'y'}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: -20, bottom: 320 }}
            dragElastic={{ top: 0.12, bottom: 0.36 }}
            dragSnapToOrigin
            onDragEnd={handleDragEnd}
            style={{
              y: dragY,
              minHeight: SNAP_MIN_HEIGHT[snapState],
              maxHeight: '92dvh',
            }}
            initial={prefersReduced ? { opacity: 0 } : { y: '100%', opacity: 0.96 }}
            animate={{
              y: 0,
              opacity: 1,
              height: SNAP_HEIGHT_DVH[snapState],
              transition: prefersReduced
                ? { duration: MOTION_DURATION.fast }
                : MOTION_SPRING.sheet,
            }}
            exit={
              prefersReduced
                ? {
                    opacity: 0,
                    pointerEvents: 'none',
                    transition: { duration: MOTION_DURATION.instant },
                  }
                : {
                    y: '100%',
                    opacity: 0.85,
                    pointerEvents: 'none',
                    transition: {
                      duration: MOTION_DURATION.fast,
                      ease: MOTION_EASE.exit,
                    },
                  }
            }
            className="pointer-events-auto relative z-10 w-full max-w-2xl mx-auto rounded-t-3xl border border-b-0 glass-level-4 flex flex-col overflow-hidden pb-safe touch-pan-y"
          >
            {/* Interactive Drag Handle & Header */}
            <div
              onPointerDown={(e) => {
                if (!prefersReduced) {
                  dragControls.start(e);
                }
              }}
              className="px-4 pt-2.5 pb-2 border-b border-black/10 dark:border-white/12 shrink-0 select-none cursor-grab active:cursor-grabbing touch-none"
            >
              <button
                type="button"
                onClick={cycleSnap}
                aria-label="Cycle sheet height"
                className="mx-auto mb-2 w-11 h-1.5 rounded-full bg-black/20 dark:bg-white/25 block hover:bg-black/45 dark:hover:bg-white/50 transition-colors"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {title && (
                    <div className="text-sm font-display font-semibold text-[#101010] dark:text-white truncate">
                      {title}
                    </div>
                  )}
                  {subtitle && (
                    <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] truncate">
                      {subtitle}
                    </div>
                  )}
                </div>
                <div
                  className="flex items-center gap-1 shrink-0"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {headerRight}
                  {onSnapChange && (
                    <motion.button
                      type="button"
                      whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                      onClick={() =>
                        onSnapChange(
                          snapState === 'expanded' ? 'medium' : 'expanded'
                        )
                      }
                      aria-label={
                        snapState === 'expanded' ? 'Shrink sheet' : 'Expand sheet'
                      }
                      className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      {snapState === 'expanded' ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronUp className="w-4 h-4" />
                      )}
                    </motion.button>
                  )}
                  <motion.button
                    type="button"
                    whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                    onClick={onClose}
                    aria-label="Close panel"
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
              </div>
            </div>

            {/* Scrollable Sheet Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
