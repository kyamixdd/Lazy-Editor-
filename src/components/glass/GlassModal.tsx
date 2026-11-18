import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  MOTION_DURATION,
  modalBackdropVariants,
  modalPanelVariants,
} from '../../config/motionSystem';

interface GlassModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const GlassModal: React.FC<GlassModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-3xl',
  footer,
  children,
}) => {
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="glass-modal-backdrop"
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={
            prefersReduced
              ? { duration: MOTION_DURATION.instant }
              : undefined
          }
          className="fixed inset-0 z-50 bg-black/40 dark:bg-black/75 backdrop-blur-sm flex items-end tablet:items-center justify-center p-0 tablet:p-4"
          onClick={onClose}
        >
          <motion.div
            key="glass-modal-panel"
            role="dialog"
            aria-modal="true"
            variants={
              prefersReduced
                ? {
                    initial: { opacity: 0 },
                    animate: { opacity: 1, transition: { duration: 0.14 } },
                    exit: {
                      opacity: 0,
                      pointerEvents: 'none',
                      transition: { duration: 0.12 },
                    },
                  }
                : modalPanelVariants
            }
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className={`w-full ${maxWidthClass} max-h-[92dvh] rounded-t-3xl tablet:rounded-2xl border glass-level-4 flex flex-col overflow-hidden pb-safe`}
          >
            <div className="px-4 tablet:px-6 py-4 border-b border-black/10 dark:border-white/12 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm tablet:text-base font-display font-semibold text-[#101010] dark:text-white truncate">
                  {title}
                </h2>
                {subtitle && (
                  <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5] mt-0.5 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
              <motion.button
                type="button"
                onClick={onClose}
                whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                aria-label="Close modal"
                className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>

            {footer && (
              <div className="px-4 tablet:px-6 py-3.5 border-t border-black/10 dark:border-white/12 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
