import type { Transition, Variants } from 'motion/react';
import { NavSection } from '../types/pdfStudio';

/**
 * Centralized Motion System for PDF Studio AI.
 * Strictly calibrated for iOS-like fluidity and macOS Liquid Glass precision
 * while preserving pure monochrome aesthetics and PDF coordinate fidelity.
 */

export const MOTION_DURATION = {
  instant: 0.12,
  fast: 0.16,
  normal: 0.22,
  moderate: 0.28,
  slow: 0.34,
} as const;

export const MOTION_EASE = {
  liquid: [0.22, 1, 0.36, 1] as const,
  standard: [0.25, 0.1, 0.25, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
} as const;

export const MOTION_SPRING = {
  snappy: {
    type: 'spring',
    stiffness: 480,
    damping: 34,
    mass: 0.78,
  } satisfies Transition,
  nav: {
    type: 'spring',
    stiffness: 430,
    damping: 33,
    mass: 0.85,
  } satisfies Transition,
  sheet: {
    type: 'spring',
    stiffness: 360,
    damping: 34,
    mass: 0.92,
  } satisfies Transition,
  modal: {
    type: 'spring',
    stiffness: 390,
    damping: 32,
    mass: 0.88,
  } satisfies Transition,
  drawer: {
    type: 'spring',
    stiffness: 390,
    damping: 36,
    mass: 0.9,
  } satisfies Transition,
  gentle: {
    type: 'spring',
    stiffness: 300,
    damping: 30,
    mass: 0.95,
  } satisfies Transition,
} as const;

export const SECTION_ORDER: Record<NavSection, number> = {
  dashboard: 0,
  'new-project': 1,
  templates: 2,
  'scan-inspector': 3,
  editor: 4,
  'blueprint-studio': 5,
  'bulk-generator': 6,
  'data-manager': 7,
  'workflow-studio': 8,
  preflight: 9,
  compare: 10,
  'batch-center': 11,
  'asset-library': 12,
  'export-center': 13,
  'pdf-utilities': 14,
  settings: 15,
  about: 16,
};

export function getNavigationDirection(from: NavSection, to: NavSection): number {
  if (from === to) return 1;
  return SECTION_ORDER[to] >= SECTION_ORDER[from] ? 1 : -1;
}

/**
 * Direction-aware screen transition variants.
 * Uses subtle horizontal/vertical translation + opacity so screens feel connected
 * without jarring jumps or canvas flicker.
 */
export const screenVariants: Variants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? 14 : -14,
    scale: 0.994,
  }),
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: MOTION_DURATION.normal,
      ease: MOTION_EASE.liquid,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction >= 0 ? -10 : 10,
    scale: 0.996,
    pointerEvents: 'none',
    transition: {
      duration: MOTION_DURATION.fast,
      ease: MOTION_EASE.exit,
    },
  }),
};

export const reducedScreenVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: MOTION_DURATION.fast },
  },
  exit: {
    opacity: 0,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.instant },
  },
};

export const modalBackdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.standard },
  },
  exit: {
    opacity: 0,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
  },
};

export const modalPanelVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: MOTION_SPRING.modal,
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 8,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
  },
};

export const drawerLeftVariants: Variants = {
  initial: { x: '-100%', opacity: 0.92 },
  animate: {
    x: 0,
    opacity: 1,
    transition: MOTION_SPRING.drawer,
  },
  exit: {
    x: '-100%',
    opacity: 0.9,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
  },
};

export const drawerRightVariants: Variants = {
  initial: { x: '100%', opacity: 0.92 },
  animate: {
    x: 0,
    opacity: 1,
    transition: MOTION_SPRING.drawer,
  },
  exit: {
    x: '100%',
    opacity: 0.9,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
  },
};

export const popoverVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.liquid },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: -3,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.instant, ease: MOTION_EASE.exit },
  },
};

export const floatingToolbarVariants: Variants = {
  initial: { opacity: 0, scale: 0.95, y: -6 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: MOTION_SPRING.snappy,
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -4,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.instant, ease: MOTION_EASE.exit },
  },
};

export const toastVariants: Variants = {
  initial: { opacity: 0, y: 10, scale: 0.97 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: MOTION_SPRING.snappy,
  },
  exit: {
    opacity: 0,
    y: 8,
    scale: 0.98,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.instant, ease: MOTION_EASE.exit },
  },
};

export const bannerVariants: Variants = {
  initial: { opacity: 0, y: -8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATION.normal, ease: MOTION_EASE.liquid },
  },
  exit: {
    opacity: 0,
    y: -6,
    pointerEvents: 'none',
    transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
  },
};

export const staggerContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: MOTION_DURATION.normal,
      ease: MOTION_EASE.liquid,
    },
  },
};

export const BUTTON_TAP = { scale: 0.975 } as const;
export const FAB_TAP = { scale: 0.95 } as const;
export const CARD_HOVER = { y: -1.5 } as const;
export const CARD_TAP = { scale: 0.988 } as const;

let dashboardIntroPlayed = false;

export function hasPlayedDashboardIntro(): boolean {
  return dashboardIntroPlayed;
}

export function markDashboardIntroPlayed(): void {
  dashboardIntroPlayed = true;
}
