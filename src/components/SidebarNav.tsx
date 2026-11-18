import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  FolderHeart,
  GitCompare,
  Info,
  Layers,
  LayoutDashboard,
  ListChecks,
  Menu,
  Moon,
  PenTool,
  Plus,
  Printer,
  Settings,
  ShieldCheck,
  Sun,
  Table2,
  Wrench,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react';
import {
  APP_PRODUCT_NAME,
  APP_SUITE_NAME,
  APP_VERSION,
} from '../config/appInfo';
import {
  FAB_TAP,
  MOTION_DURATION,
  MOTION_SPRING,
  drawerLeftVariants,
  modalBackdropVariants,
} from '../config/motionSystem';
import { useViewport } from '../hooks/useViewport';
import { NavSection, PDFProject, WorkspaceLayoutMode } from '../types/pdfStudio';
import { BrandMark } from './BrandMark';
import { GlassBottomSheet } from './glass';

interface SidebarNavProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  activeProject: PDFProject | null;
  onCloseProject: () => void;
  theme: 'dark' | 'light' | 'system';
  resolvedTheme: 'dark' | 'light';
  onToggleTheme: () => void;
  widthPx?: number;
  workspaceLayout?: WorkspaceLayoutMode;
  mobileDrawerOpen?: boolean;
  onMobileDrawerOpenChange?: (open: boolean) => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  shortLabel: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresProject?: boolean;
}> = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Home',
    desc: 'Workspace overview',
    icon: LayoutDashboard,
  },
  {
    id: 'new-project',
    label: 'New PDF Project',
    shortLabel: 'Create',
    desc: 'Upload & scan locally',
    icon: FilePlus2,
  },
  {
    id: 'templates',
    label: 'My Templates',
    shortLabel: 'Projects',
    desc: 'Projects & profiles',
    icon: Layers,
  },
  {
    id: 'editor',
    label: 'PDF Editor',
    shortLabel: 'Editor',
    desc: 'Visual layout & text',
    icon: PenTool,
    requiresProject: true,
  },
  {
    id: 'bulk-generator',
    label: 'Bulk Generator',
    shortLabel: 'Bulk',
    desc: 'Multi-copy & serials',
    icon: Printer,
    requiresProject: true,
  },
  {
    id: 'data-manager',
    label: 'Data Manager',
    shortLabel: 'Data',
    desc: 'CSV / Excel merge',
    icon: Table2,
    requiresProject: true,
  },
  {
    id: 'preflight',
    label: 'Preflight QC',
    shortLabel: 'QC',
    desc: 'Quality inspection',
    icon: ShieldCheck,
    requiresProject: true,
  },
  {
    id: 'compare',
    label: 'Compare PDFs',
    shortLabel: 'Compare',
    desc: 'Original vs edited',
    icon: GitCompare,
    requiresProject: true,
  },
  {
    id: 'batch-center',
    label: 'Batch Center',
    shortLabel: 'Batch',
    desc: 'Queue & job history',
    icon: ListChecks,
  },
  {
    id: 'asset-library',
    label: 'Asset Library',
    shortLabel: 'Assets',
    desc: 'Fonts, logos & shapes',
    icon: FolderHeart,
  },
  {
    id: 'export-center',
    label: 'Export Center',
    shortLabel: 'Export',
    desc: 'PDF, ZIP & print',
    icon: Download,
    requiresProject: true,
  },
  {
    id: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
    desc: 'Theme, grid & keys',
    icon: Settings,
  },
  {
    id: 'about',
    label: 'About Us',
    shortLabel: 'About',
    desc: APP_PRODUCT_NAME,
    icon: Info,
  },
];

const TOOL_HUB_IDS: NavSection[] = [
  'editor',
  'bulk-generator',
  'data-manager',
  'preflight',
  'compare',
  'export-center',
  'batch-center',
  'asset-library',
];

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeSection,
  onSelectSection,
  activeProject,
  onCloseProject,
  resolvedTheme,
  onToggleTheme,
  widthPx = 240,
  workspaceLayout = 'standard',
  mobileDrawerOpen: controlledDrawerOpen,
  onMobileDrawerOpenChange,
}) => {
  const { isMobile, isTablet } = useViewport();
  const prefersReduced = useReducedMotion();
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(false);
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  const [tabletExpanded, setTabletExpanded] = useState(false);

  const mobileDrawerOpen =
    controlledDrawerOpen !== undefined ? controlledDrawerOpen : internalDrawerOpen;
  const setMobileDrawerOpen = (open: boolean) => {
    setInternalDrawerOpen(open);
    onMobileDrawerOpenChange?.(open);
  };

  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeSection);
  const isToolSectionActive = TOOL_HUB_IDS.includes(activeSection);

  const handleNavClick = (id: NavSection, disabled?: boolean) => {
    if (disabled) return;
    onSelectSection(id);
    setMobileDrawerOpen(false);
    setToolsSheetOpen(false);
  };

  const renderThemeIcon = () => (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={resolvedTheme}
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, rotate: -35, scale: 0.8 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        exit={prefersReduced ? { opacity: 0 } : { opacity: 0, rotate: 35, scale: 0.8 }}
        transition={{ duration: MOTION_DURATION.instant }}
        className="flex items-center justify-center"
      >
        {resolvedTheme === 'dark' ? (
          <Sun className="w-4 h-4" />
        ) : (
          <Moon className="w-4 h-4" />
        )}
      </motion.span>
    </AnimatePresence>
  );

  // MOBILE NAVIGATION (< 768px): Compact Liquid Glass header + Slide-Out Drawer + 5-tab Glass Bottom Navigation
  if (isMobile) {
    const isEditor = activeSection === 'editor';
    const mobileBottomActiveTab: 'dashboard' | 'templates' | 'tools' | 'settings' | null =
      activeSection === 'dashboard'
        ? 'dashboard'
        : activeSection === 'templates'
        ? 'templates'
        : isToolSectionActive || toolsSheetOpen
        ? 'tools'
        : activeSection === 'settings'
        ? 'settings'
        : null;

    return (
      <>
        {!isEditor && (
          <header className="sticky top-0 z-40 h-12 px-3 flex items-center justify-between gap-2 glass-level-2 border-b pt-safe shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <motion.button
                type="button"
                whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                onClick={() => setMobileDrawerOpen(true)}
                aria-label="Open navigation menu"
                className="min-h-[44px] min-w-[44px] -ml-1.5 flex items-center justify-center rounded-xl text-[#101010] dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
              >
                <Menu className="w-5 h-5" />
              </motion.button>
              <div className="min-w-0 flex items-center gap-2">
                <BrandMark size="sm" />
                <span className="text-sm font-display font-semibold text-[#101010] dark:text-white truncate">
                  {activeNavItem?.label || APP_SUITE_NAME}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <motion.button
                type="button"
                whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                onClick={onToggleTheme}
                aria-label="Toggle color theme"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
              >
                {renderThemeIcon()}
              </motion.button>
            </div>
          </header>
        )}

        {/* Slide-Out Mobile Glass Drawer with Spring Motion */}
        <AnimatePresence>
          {mobileDrawerOpen && (
            <div className="fixed inset-0 z-50 flex">
              <motion.div
                key="mobile-drawer-backdrop"
                variants={modalBackdropVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onClick={() => setMobileDrawerOpen(false)}
                className="fixed inset-0 bg-black/45 dark:bg-black/70 backdrop-blur-[2px]"
              />
              <motion.aside
                key="mobile-drawer-panel"
                variants={
                  prefersReduced
                    ? {
                        initial: { opacity: 0 },
                        animate: { opacity: 1, transition: { duration: 0.14 } },
                        exit: { opacity: 0, pointerEvents: 'none', transition: { duration: 0.12 } },
                      }
                    : drawerLeftVariants
                }
                initial="initial"
                animate="animate"
                exit="exit"
                className="relative w-72 max-w-[85vw] h-full glass-level-4 border-r flex flex-col z-10 pb-safe"
              >
                <div className="h-14 px-4 flex items-center justify-between border-b border-black/10 dark:border-white/12">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <BrandMark size="md" />
                    <div className="min-w-0">
                      <div className="font-display font-semibold text-sm text-[#101010] dark:text-white leading-tight truncate">
                        {APP_SUITE_NAME}
                      </div>
                      <div className="text-[10px] text-[#555555] dark:text-[#B5B5B5] leading-tight truncate">
                        {APP_PRODUCT_NAME}
                      </div>
                    </div>
                  </div>
                  <motion.button
                    type="button"
                    whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                    onClick={() => setMobileDrawerOpen(false)}
                    aria-label="Close navigation menu"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </motion.button>
                </div>

                <div className="px-4 py-3 border-b border-black/10 dark:border-white/12">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                      Active Document
                    </span>
                    {activeProject && (
                      <button
                        type="button"
                        onClick={() => {
                          onCloseProject();
                          setMobileDrawerOpen(false);
                        }}
                        className="text-xs text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white font-medium py-1 px-2"
                      >
                        Close
                      </button>
                    )}
                  </div>
                  {activeProject ? (
                    <>
                      <div className="text-sm font-medium text-[#101010] dark:text-white truncate">
                        {activeProject.name}
                      </div>
                      <div className="mt-0.5 text-xs text-[#888888] dark:text-[#858585] tabular-nums">
                        {activeProject.pageCount} pg · {activeProject.elements.length} el · v{activeProject.version}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-[#888888] dark:text-[#858585]">No project loaded</div>
                  )}
                </div>

                <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeSection === item.id;
                    const disabled = Boolean(item.requiresProject && !activeProject);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleNavClick(item.id, disabled)}
                        className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-xl text-sm font-medium transition-colors border ${
                          isActive
                            ? 'bg-[#101010] text-white border-black/15 dark:bg-white dark:text-[#050505] dark:border-white/30 shadow-xs'
                            : disabled
                            ? 'border-transparent text-[#888888]/50 dark:text-[#858585]/45 cursor-not-allowed'
                            : 'border-transparent text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        {/* Mobile Tools Hub Sheet */}
        <GlassBottomSheet
          isOpen={toolsSheetOpen}
          snapState="medium"
          onClose={() => setToolsSheetOpen(false)}
          title="Studio Tools"
          subtitle={
            activeProject
              ? `Active: ${activeProject.name}`
              : 'Open a project to unlock document-specific tools'
          }
        >
          <div className="p-4 grid grid-cols-2 gap-2.5">
            {TOOL_HUB_IDS.map((id) => {
              const item = NAV_ITEMS.find((n) => n.id === id)!;
              const Icon = item.icon;
              const disabled = Boolean(item.requiresProject && !activeProject);
              const isActive = activeSection === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  disabled={disabled}
                  whileTap={!disabled && !prefersReduced ? { scale: 0.97 } : undefined}
                  transition={MOTION_SPRING.snappy}
                  onClick={() => handleNavClick(id, disabled)}
                  className={`min-h-[68px] p-3 rounded-2xl border text-left transition-[border-color,background-color] flex flex-col justify-between ${
                    isActive
                      ? 'bg-[#101010] text-white border-black/20 dark:bg-white dark:text-[#050505] dark:border-white/40'
                      : disabled
                      ? 'border-black/5 dark:border-white/5 opacity-40 cursor-not-allowed'
                      : 'glass-level-3 border hover:border-black/25 dark:hover:border-white/30 text-[#101010] dark:text-white'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${
                      isActive
                        ? 'text-white dark:text-[#050505]'
                        : 'text-[#101010] dark:text-white'
                    }`}
                  />
                  <div className="mt-2">
                    <div className="text-xs font-semibold truncate">{item.label}</div>
                    <div
                      className={`text-[10px] truncate ${
                        isActive
                          ? 'text-white/75 dark:text-[#050505]/70'
                          : 'text-[#888888] dark:text-[#858585]'
                      }`}
                    >
                      {disabled ? 'Requires project' : item.desc}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </GlassBottomSheet>

        {/* 5-Tab Liquid Glass Bottom Bar (hidden inside full-screen Editor) */}
        {!isEditor && (
          <LayoutGroup id="mobile-bottom-nav">
            <nav
              aria-label="Primary mobile navigation"
              className="fixed bottom-0 left-0 right-0 z-40 glass-level-2 border-t pb-safe"
            >
              <div className="grid grid-cols-5 h-14 items-center px-1">
                {/* 1. Home */}
                <button
                  type="button"
                  onClick={() => handleNavClick('dashboard')}
                  className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors rounded-xl ${
                    mobileBottomActiveTab === 'dashboard'
                      ? 'text-[#101010] dark:text-white font-semibold'
                      : 'text-[#888888] dark:text-[#858585]'
                  }`}
                >
                  {mobileBottomActiveTab === 'dashboard' && (
                    <motion.span
                      layoutId="mobile-tab-indicator"
                      transition={
                        prefersReduced
                          ? { duration: MOTION_DURATION.instant }
                          : MOTION_SPRING.nav
                      }
                      className="absolute inset-x-2 inset-y-1 rounded-xl bg-black/[0.06] dark:bg-white/[0.11] border border-black/10 dark:border-white/15"
                      aria-hidden="true"
                    />
                  )}
                  <LayoutDashboard className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">Home</span>
                </button>

                {/* 2. Projects */}
                <button
                  type="button"
                  onClick={() => handleNavClick('templates')}
                  className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors rounded-xl ${
                    mobileBottomActiveTab === 'templates'
                      ? 'text-[#101010] dark:text-white font-semibold'
                      : 'text-[#888888] dark:text-[#858585]'
                  }`}
                >
                  {mobileBottomActiveTab === 'templates' && (
                    <motion.span
                      layoutId="mobile-tab-indicator"
                      transition={
                        prefersReduced
                          ? { duration: MOTION_DURATION.instant }
                          : MOTION_SPRING.nav
                      }
                      className="absolute inset-x-2 inset-y-1 rounded-xl bg-black/[0.06] dark:bg-white/[0.11] border border-black/10 dark:border-white/15"
                      aria-hidden="true"
                    />
                  )}
                  <Layers className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">Projects</span>
                </button>

                {/* 3. Create (Visually distinctive center action) */}
                <div className="flex items-center justify-center">
                  <motion.button
                    type="button"
                    whileTap={!prefersReduced ? FAB_TAP : undefined}
                    whileHover={!prefersReduced ? { scale: 1.03, y: -1 } : undefined}
                    transition={MOTION_SPRING.snappy}
                    onClick={() => handleNavClick('new-project')}
                    aria-label="Create New PDF"
                    className={`-mt-3 min-w-[52px] min-h-[46px] px-3 rounded-2xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] border border-black/20 dark:border-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_24px_-6px_rgba(0,0,0,0.45)] flex flex-col items-center justify-center touch-manipulation ${
                      activeSection === 'new-project'
                        ? 'ring-2 ring-black/25 dark:ring-white/35'
                        : ''
                    }`}
                  >
                    <Plus className="w-5 h-5 stroke-[2.4]" />
                  </motion.button>
                </div>

                {/* 4. Tools */}
                <button
                  type="button"
                  onClick={() => setToolsSheetOpen(true)}
                  className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors rounded-xl ${
                    mobileBottomActiveTab === 'tools'
                      ? 'text-[#101010] dark:text-white font-semibold'
                      : 'text-[#888888] dark:text-[#858585]'
                  }`}
                >
                  {mobileBottomActiveTab === 'tools' && (
                    <motion.span
                      layoutId="mobile-tab-indicator"
                      transition={
                        prefersReduced
                          ? { duration: MOTION_DURATION.instant }
                          : MOTION_SPRING.nav
                      }
                      className="absolute inset-x-2 inset-y-1 rounded-xl bg-black/[0.06] dark:bg-white/[0.11] border border-black/10 dark:border-white/15"
                      aria-hidden="true"
                    />
                  )}
                  <Wrench className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">Tools</span>
                </button>

                {/* 5. Settings */}
                <button
                  type="button"
                  onClick={() => handleNavClick('settings')}
                  className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors rounded-xl ${
                    mobileBottomActiveTab === 'settings'
                      ? 'text-[#101010] dark:text-white font-semibold'
                      : 'text-[#888888] dark:text-[#858585]'
                  }`}
                >
                  {mobileBottomActiveTab === 'settings' && (
                    <motion.span
                      layoutId="mobile-tab-indicator"
                      transition={
                        prefersReduced
                          ? { duration: MOTION_DURATION.instant }
                          : MOTION_SPRING.nav
                      }
                      className="absolute inset-x-2 inset-y-1 rounded-xl bg-black/[0.06] dark:bg-white/[0.11] border border-black/10 dark:border-white/15"
                      aria-hidden="true"
                    />
                  )}
                  <Settings className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">Settings</span>
                </button>
              </div>
            </nav>
          </LayoutGroup>
        )}
      </>
    );
  }

  // TABLET (768px - 1199px) & DESKTOP (>= 1200px) LIQUID GLASS SIDEBAR
  const isCollapsedRail = isTablet && !tabletExpanded;
  const targetWidth = isCollapsedRail ? 64 : isTablet ? 240 : widthPx;

  return (
    <motion.aside
      initial={false}
      animate={{ width: targetWidth }}
      transition={
        prefersReduced
          ? { duration: MOTION_DURATION.instant }
          : MOTION_SPRING.drawer
      }
      className="shrink-0 h-screen sticky top-0 flex flex-col border-r glass-level-2 select-none z-30 overflow-hidden"
    >
      {/* Brand header */}
      <div className="h-14 px-3 flex items-center justify-between border-b border-black/10 dark:border-white/12">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark size="md" />
          {!isCollapsedRail && (
            <div className="min-w-0">
              <div className="font-display font-semibold text-sm tracking-tight text-[#101010] dark:text-white whitespace-nowrap truncate leading-tight">
                {APP_SUITE_NAME}
              </div>
              <div className="text-[10px] text-[#555555] dark:text-[#B5B5B5] whitespace-nowrap truncate leading-tight">
                {APP_PRODUCT_NAME}
              </div>
            </div>
          )}
        </div>
        {!isCollapsedRail && (
          <div className="flex items-center gap-0.5">
            <motion.button
              type="button"
              whileTap={!prefersReduced ? { scale: 0.9 } : undefined}
              onClick={onToggleTheme}
              title={
                resolvedTheme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              aria-label="Toggle color theme"
              className="p-1.5 rounded-lg text-[#555555] hover:text-[#101010] hover:bg-black/[0.06] dark:text-[#B5B5B5] dark:hover:text-white dark:hover:bg-white/[0.08] transition-colors"
            >
              {renderThemeIcon()}
            </motion.button>
            {isTablet && (
              <motion.button
                type="button"
                whileTap={!prefersReduced ? { scale: 0.9 } : undefined}
                onClick={() => setTabletExpanded(false)}
                title="Collapse sidebar"
                className="p-1.5 rounded-lg text-[#555555] hover:text-[#101010] hover:bg-black/[0.06] dark:text-[#B5B5B5] dark:hover:text-white dark:hover:bg-white/[0.08] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </motion.button>
            )}
          </div>
        )}
      </div>

      {isTablet && isCollapsedRail && (
        <div className="py-2 flex flex-col items-center gap-1 border-b border-black/10 dark:border-white/12">
          <motion.button
            type="button"
            whileTap={!prefersReduced ? { scale: 0.9 } : undefined}
            onClick={() => setTabletExpanded(true)}
            title="Expand sidebar"
            className="w-10 h-10 flex items-center justify-center rounded-xl text-[#555555] hover:text-[#101010] hover:bg-black/[0.06] dark:text-[#B5B5B5] dark:hover:text-white dark:hover:bg-white/[0.08] transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </motion.button>
          <motion.button
            type="button"
            whileTap={!prefersReduced ? { scale: 0.9 } : undefined}
            onClick={onToggleTheme}
            title="Toggle theme"
            className="w-10 h-10 flex items-center justify-center rounded-xl text-[#555555] hover:text-[#101010] hover:bg-black/[0.06] dark:text-[#B5B5B5] dark:hover:text-white dark:hover:bg-white/[0.08] transition-colors"
          >
            {renderThemeIcon()}
          </motion.button>
        </div>
      )}

      {/* Active Document Context */}
      {!isCollapsedRail && (
        <div className="px-3 py-3 border-b border-black/10 dark:border-white/12">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
              Active Document
            </span>
            {activeProject && (
              <button
                type="button"
                onClick={onCloseProject}
                title="Close active project"
                className="text-[11px] text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white flex items-center gap-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
                Close
              </button>
            )}
          </div>
          {activeProject ? (
            <div className="text-xs font-semibold text-[#101010] dark:text-white truncate">
              {activeProject.name}
            </div>
          ) : (
            <div className="text-xs text-[#888888] dark:text-[#858585]">
              No project loaded
            </div>
          )}
          {activeProject && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
              <span>{activeProject.pageCount} pg</span>
              <span aria-hidden="true">·</span>
              <span>{activeProject.elements.length} el</span>
              <span aria-hidden="true">·</span>
              <span>v{activeProject.version}</span>
            </div>
          )}
        </div>
      )}

      {/* Primary Navigation with Smooth Gliding Active Indicator */}
      <LayoutGroup id="desktop-sidebar-nav">
        <nav
          className={`flex-1 overflow-y-auto px-2 ${
            workspaceLayout === 'compact' ? 'py-2 space-y-0.5' : 'py-3 space-y-1'
          }`}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const disabled = Boolean(item.requiresProject && !activeProject);

            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                title={isCollapsedRail ? item.label : undefined}
                onClick={() => handleNavClick(item.id, disabled)}
                className={`relative w-full ${
                  workspaceLayout === 'compact' ? 'min-h-[34px] py-1.5' : 'min-h-[38px] py-2'
                } flex items-center ${
                  isCollapsedRail ? 'justify-center px-0' : 'gap-2.5 px-3'
                } rounded-xl text-[13px] font-medium transition-colors duration-150 whitespace-nowrap shrink-0 border border-transparent ${
                  isActive
                    ? 'text-white dark:text-white'
                    : disabled
                    ? 'text-[#888888]/50 dark:text-[#858585]/45 cursor-not-allowed'
                    : 'text-[#555555] hover:text-[#101010] hover:bg-black/[0.045] dark:text-[#B5B5B5] dark:hover:text-white dark:hover:bg-white/[0.07]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    transition={
                      prefersReduced
                        ? { duration: MOTION_DURATION.instant }
                        : MOTION_SPRING.nav
                    }
                    className="absolute inset-0 rounded-xl bg-[#101010] border border-black/15 dark:bg-white/[0.12] dark:border-white/25 shadow-[inset_0_1px_0_var(--glass-highlight)]"
                    aria-hidden="true"
                  />
                )}
                <Icon className="w-4 h-4 shrink-0 relative z-10" />
                {!isCollapsedRail && (
                  <span className="truncate relative z-10">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>
      </LayoutGroup>

      {/* Bottom Workspace Info */}
      {!isCollapsedRail && (
        <div className="px-4 py-3 border-t border-black/10 dark:border-white/12 text-[11px] text-[#888888] dark:text-[#858585]">
          {activeProject ? (
            <div className="flex items-center justify-between tabular-nums">
              <span>{activeProject.pageConfig.sizePreset}</span>
              <span>
                {Math.round(activeProject.pageConfig.widthPt)}×
                {Math.round(activeProject.pageConfig.heightPt)} pt
              </span>
            </div>
          ) : (
            <span>
              {APP_PRODUCT_NAME} · v{APP_VERSION}
            </span>
          )}
        </div>
      )}
    </motion.aside>
  );
};
