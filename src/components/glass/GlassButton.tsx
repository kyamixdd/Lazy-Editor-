import React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { BUTTON_TAP, MOTION_SPRING } from '../../config/motionSystem';

export type GlassButtonVariant = 'primary' | 'glass' | 'ghost' | 'danger';
export type GlassButtonSize = 'sm' | 'md' | 'lg';

interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  active?: boolean;
}

const VARIANT_CLASSES: Record<GlassButtonVariant, string> = {
  primary:
    'bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E5E5E5] border border-black/15 dark:border-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_20px_-8px_rgba(0,0,0,0.45)]',
  glass:
    'glass-level-2 border text-[#101010] dark:text-white hover:border-black/25 dark:hover:border-white/30 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]',
  ghost:
    'border border-transparent text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
  danger:
    'border border-black/20 dark:border-white/20 bg-black/[0.04] dark:bg-white/[0.06] text-[#101010] dark:text-white hover:bg-black/[0.09] dark:hover:bg-white/[0.12]',
};

const SIZE_CLASSES: Record<GlassButtonSize, string> = {
  sm: 'min-h-[36px] tablet:min-h-[32px] px-2.5 py-1 text-xs rounded-lg',
  md: 'min-h-[44px] tablet:min-h-[38px] px-3.5 py-2 text-xs rounded-xl',
  lg: 'min-h-[46px] px-5 py-2.5 text-sm rounded-xl',
};

export const GlassButton: React.FC<GlassButtonProps> = ({
  variant = 'glass',
  size = 'md',
  active = false,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}) => {
  const prefersReduced = useReducedMotion();

  const activeRing = active
    ? 'border-black/35 bg-black/[0.08] text-[#101010] dark:border-white/35 dark:bg-white/[0.14] dark:text-white shadow-[inset_0_1px_0_var(--glass-highlight)]'
    : '';

  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileTap={!disabled && !prefersReduced ? BUTTON_TAP : undefined}
      transition={MOTION_SPRING.snappy}
      className={`inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap touch-manipulation transition-[opacity,border-color,background-color,box-shadow,color] duration-150 disabled:opacity-40 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${activeRing} ${className}`}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      {children}
    </motion.button>
  );
};
