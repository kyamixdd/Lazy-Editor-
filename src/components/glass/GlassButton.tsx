import React from 'react';

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
    'bg-gradient-to-b from-blue-500 to-blue-600 text-white border border-blue-400/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-6px_rgba(37,99,235,0.55)] hover:from-blue-500 hover:to-blue-700',
  glass:
    'glass-level-2 border text-slate-800 dark:text-slate-100 hover:border-blue-500/40',
  ghost:
    'border border-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/8',
  danger:
    'border border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/18',
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
  children,
  ...rest
}) => {
  const activeRing = active
    ? 'border-blue-500/60 bg-blue-500/15 text-blue-700 dark:text-blue-300'
    : '';

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap touch-manipulation transition-[transform,opacity,border-color,background-color] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${activeRing} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};
