import React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { CARD_HOVER, CARD_TAP, MOTION_SPRING } from '../../config/motionSystem';

export type GlassLevel = 1 | 2 | 3 | 4;

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: GlassLevel;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const LEVEL_CLASS: Record<GlassLevel, string> = {
  1: 'glass-level-1',
  2: 'glass-level-2',
  3: 'glass-level-3',
  4: 'glass-level-4',
};

const PADDING_CLASS: Record<'none' | 'sm' | 'md' | 'lg', string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4 tablet:p-5',
  lg: 'p-5 tablet:p-6',
};

export const GlassCard: React.FC<GlassCardProps> = ({
  level = 3,
  interactive = false,
  padding = 'md',
  className = '',
  children,
  ...rest
}) => {
  const prefersReduced = useReducedMotion();

  if (interactive) {
    return (
      <motion.div
        whileHover={!prefersReduced ? CARD_HOVER : undefined}
        whileTap={!prefersReduced ? CARD_TAP : undefined}
        transition={MOTION_SPRING.snappy}
        className={`rounded-2xl border ${LEVEL_CLASS[level]} ${PADDING_CLASS[padding]} glass-interactive cursor-pointer ${className}`}
        {...(rest as HTMLMotionProps<'div'>)}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div
      className={`rounded-2xl border ${LEVEL_CLASS[level]} ${PADDING_CLASS[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};
