import React from 'react';

interface GlassToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  floating?: boolean;
}

export const GlassToolbar: React.FC<GlassToolbarProps> = ({
  floating = false,
  className = '',
  children,
  ...rest
}) => {
  return (
    <div
      className={`glass-level-2 border ${
        floating ? 'rounded-2xl px-2.5 py-1.5' : 'border-x-0 border-t-0 px-3 py-1.5'
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};
