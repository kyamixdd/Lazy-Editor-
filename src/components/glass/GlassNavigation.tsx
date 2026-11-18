import React from 'react';

interface GlassNavigationProps extends React.HTMLAttributes<HTMLElement> {
  position?: 'sidebar' | 'bottom' | 'topbar';
}

export const GlassNavigation: React.FC<GlassNavigationProps> = ({
  position = 'sidebar',
  className = '',
  children,
  ...rest
}) => {
  const borderClass =
    position === 'bottom'
      ? 'border-t border-x-0 border-b-0'
      : position === 'topbar'
      ? 'border-b border-x-0 border-t-0'
      : 'border-r border-y-0 border-l-0';

  return (
    <nav
      className={`glass-level-2 ${borderClass} ${className}`}
      {...rest}
    >
      {children}
    </nav>
  );
};
