import React from 'react';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  size = 'md',
  className = '',
}) => {
  const sizeClasses =
    size === 'sm'
      ? 'w-6 h-6 rounded-lg'
      : size === 'lg'
      ? 'w-12 h-12 rounded-2xl'
      : 'w-8 h-8 rounded-xl';

  const svgSize =
    size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';

  return (
    <div
      aria-hidden="true"
      className={`${sizeClasses} bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white flex items-center justify-center shrink-0 border border-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_6px_16px_-4px_rgba(37,99,235,0.45)] ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={svgSize}
      >
        {/* Back layered sheet */}
        <path
          d="M7 4.5H14.5L18.5 8.5V19.5C18.5 20.0523 18.0523 20.5 17.5 20.5H7C6.44772 20.5 6 20.0523 6 19.5V5.5C6 4.94772 6.44772 4.5 7 4.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          opacity="0.55"
        />
        {/* Primary sheet with corner fold */}
        <path
          d="M5 3.5H12.5L16.5 7.5V17.5C16.5 18.0523 16.0523 18.5 15.5 18.5H5C4.44772 18.5 4 18.0523 4 17.5V4.5C4 3.94772 4.44772 3.5 5 3.5Z"
          fill="currentColor"
          fillOpacity="0.16"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12.5 3.5V7.5H16.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Precision alignment grid lines */}
        <path
          d="M7 11H13.5M7 14H11.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};
