import React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { FAB_TAP, MOTION_SPRING } from '../../config/motionSystem';

interface GlassFloatingActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  icon: React.ReactNode;
  size?: 'md' | 'lg';
}

export const GlassFloatingActionButton: React.FC<
  GlassFloatingActionButtonProps
> = ({ label, icon, size = 'md', className = '', type = 'button', disabled, ...rest }) => {
  const prefersReduced = useReducedMotion();

  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={!disabled && !prefersReduced ? { y: -1, scale: 1.015 } : undefined}
      whileTap={!disabled && !prefersReduced ? FAB_TAP : undefined}
      transition={MOTION_SPRING.snappy}
      className={`inline-flex items-center justify-center gap-2 font-medium bg-[#101010] text-white hover:bg-[#242424] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E8E8E8] border border-black/15 dark:border-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_28px_-8px_rgba(0,0,0,0.45)] transition-[background-color,box-shadow,border-color] duration-150 touch-manipulation whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none ${
        size === 'lg'
          ? 'min-h-[50px] px-5 rounded-full text-sm'
          : 'min-h-[44px] px-4 rounded-full text-xs'
      } ${className}`}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      {icon}
      {label && <span>{label}</span>}
    </motion.button>
  );
};
