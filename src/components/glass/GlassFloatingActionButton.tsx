import React from 'react';

interface GlassFloatingActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  icon: React.ReactNode;
  size?: 'md' | 'lg';
}

export const GlassFloatingActionButton: React.FC<
  GlassFloatingActionButtonProps
> = ({ label, icon, size = 'md', className = '', type = 'button', ...rest }) => {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 font-medium text-white bg-gradient-to-b from-blue-500 via-blue-600 to-indigo-600 border border-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_12px_28px_-6px_rgba(37,99,235,0.65)] hover:brightness-110 active:scale-[0.96] transition-[transform,filter] duration-150 touch-manipulation whitespace-nowrap ${
        size === 'lg'
          ? 'min-h-[50px] px-5 rounded-full text-sm'
          : 'min-h-[44px] px-4 rounded-full text-xs'
      } ${className}`}
      {...rest}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
};
