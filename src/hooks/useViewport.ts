import { useEffect, useState } from 'react';

export type ViewportBreakpoint = 'mobile' | 'tablet' | 'desktop';

export interface ViewportState {
  width: number;
  height: number;
  visualHeight: number;
  keyboardOpen: boolean;
  breakpoint: ViewportBreakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
}

function getBreakpoint(width: number): ViewportBreakpoint {
  if (width >= 1200) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'mobile';
}

function readViewport(): ViewportState {
  if (typeof window === 'undefined') {
    return {
      width: 1440,
      height: 900,
      visualHeight: 900,
      keyboardOpen: false,
      breakpoint: 'desktop',
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isTouchDevice: false,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const visualHeight = window.visualViewport?.height ?? height;
  const breakpoint = getBreakpoint(width);
  const keyboardOpen = height - visualHeight > 140;
  const isTouchDevice =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia?.('(pointer: coarse)').matches === true;

  return {
    width,
    height,
    visualHeight,
    keyboardOpen,
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    isTouchDevice,
  };
}

export function useViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>(() => readViewport());

  useEffect(() => {
    const update = () => setState(readViewport());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return state;
}
