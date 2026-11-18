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
  APP_PRODUCT_NAME,
  APP_SUITE_NAME,
  APP_VERSION,
} from '../config/appInfo';
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

  // MOBILE NAVIGATION (< 768px): Compact Liquid Glass header + Slide-Out Drawer + 5-tab Glass Bottom Navigation
  if (isMobile) {
    const isEditor = activeSection === 'editor';

    return (
      <>
        {!isEditor && (
          <header className="sticky top-0 z-40 h-12 px-3 flex items-center justify-between gap-2 glass-level-2 border-b pt-safe shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                aria-label="Open navigation menu"
                className="min-h-[44px] min-w-[44px] -ml-1.5 flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/10"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex items-center gap-2">
                <BrandMark size="sm" />
                <span className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {activeNavItem?.label || APP_SUITE_NAME}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label="Toggle color theme"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-white/10"
              >
                {resolvedTheme === 'dark' ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>
            </div>
          </header>
        )}

        {/* Slide-Out Mobile Glass Drawer */}
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 flex">
            <div
              onClick={() => setMobileDrawerOpen(false)}
              className="fixed inset-0 bg-slate-950/45 dark:bg-black/60 backdrop-blur-[2px]"
            />
            <aside className="relative w-72 max-w-[85vw] h-full glass-level-4 border-r flex flex-col z-10 pb-safe">
              <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200/70 dark:border-white/10">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BrandMark size="md" />
                  <div className="min-w-0">
                    <div className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100 leading-tight truncate">
                      {APP_SUITE_NAME}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight truncate">
                      {APP_PRODUCT_NAME}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-4 py-3 border-b border-slate-200/70 dark:border-white/10">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Active Document
                  </span>
                  {activeProject && (
                    <button
                      type="button"
                      onClick={() => {
                        onCloseProject();
                        setMobileDrawerOpen(false);
                      }}
                      className="text-xs text-red-500 font-medium py-1 px-2"
                    >
                      Close
                    </button>
                  )}
                </div>
                {activeProject ? (
                  <>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {activeProject.name}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                      {activeProject.pageCount} pg · {activeProject.elements.length} el · v{activeProject.version}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-slate-400">No project loaded</div>
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
                      className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-xl text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-600/14 text-blue-700 dark:bg-blue-500/18 dark:text-blue-300 border border-blue-500/25'
                          : disabled
                          ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-white/8'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}

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
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleNavClick(id, disabled)}
                  className={`min-h-[68px] p-3 rounded-2xl border text-left transition-[transform,border-color] active:scale-[0.98] flex flex-col justify-between ${
                    isActive
                      ? 'border-blue-500/50 bg-blue-500/14 text-blue-700 dark:text-blue-300'
                      : disabled
                      ? 'border-slate-200/50 dark:border-white/5 opacity-45 cursor-not-allowed'
                      : 'glass-level-3 border hover:border-blue-500/40 text-slate-800 dark:text-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <div className="mt-2">
                    <div className="text-xs font-semibold truncate">{item.label}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {disabled ? 'Requires project' : item.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </GlassBottomSheet>

        {/* 5-Tab Liquid Glass Bottom Bar (hidden inside full-screen Editor) */}
        {!isEditor && (
          <nav
            aria-label="Primary mobile navigation"
            className="fixed bottom-0 left-0 right-0 z-40 glass-level-2 border-t pb-safe"
          >
            <div className="grid grid-cols-5 h-14 items-center px-1">
              {/* 1. Home */}
              <button
                type="button"
                onClick={() => handleNavClick('dashboard')}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  activeSection === 'dashboard'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Home</span>
              </button>

              {/* 2. Projects */}
              <button
                type="button"
                onClick={() => handleNavClick('templates')}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  activeSection === 'templates'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Projects</span>
              </button>

              {/* 3. Create (Visually distinctive center action) */}
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => handleNavClick('new-project')}
                  aria-label="Create New PDF"
                  className="-mt-3 min-w-[52px] min-h-[46px] px-3 rounded-2xl bg-gradient-to-b from-blue-500 via-blue-600 to-indigo-600 text-white border border-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_24px_-6px_rgba(37,99,235,0.68)] flex flex-col items-center justify-center active:scale-[0.95] transition-transform touch-manipulation"
                >
                  <Plus className="w-5 h-5 stroke-[2.4]" />
                </button>
              </div>

              {/* 4. Tools */}
              <button
                type="button"
                onClick={() => setToolsSheetOpen(true)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  isToolSectionActive || toolsSheetOpen
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Wrench className="w-4 h-4" />
                <span>Tools</span>
              </button>

              {/* 5. Settings */}
              <button
                type="button"
                onClick={() => handleNavClick('settings')}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                  activeSection === 'settings'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
            </div>
          </nav>
        )}
      </>
    );
  }

  // TABLET (768px - 1199px) & DESKTOP (>= 1200px) LIQUID GLASS SIDEBAR
  const isCollapsedRail = isTablet && !tabletExpanded;

  return (
    <aside
      style={!isCollapsedRail && !isTablet ? { width: `${widthPx}px` } : undefined}
      className={`${
        isCollapsedRail ? 'w-16' : 'w-60'
      } shrink-0 h-screen sticky top-0 flex flex-col border-r glass-level-2 select-none transition-[width] duration-150 z-30`}
    >
      {/* Brand header */}
      <div className="h-14 px-3 flex items-center justify-between border-b border-slate-200/70 dark:border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark size="md" />
          {!isCollapsedRail && (
            <div className="min-w-0">
              <div className="font-display font-semibold text-sm tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap truncate leading-tight">
                {APP_SUITE_NAME}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap truncate leading-tight">
                {APP_PRODUCT_NAME}
              </div>
            </div>
          )}
        </div>
        {!isCollapsedRail && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onToggleTheme}
              title={
                resolvedTheme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              aria-label="Toggle color theme"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/10 transition-colors"
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            {isTablet && (
              <button
                type="button"
                onClick={() => setTabletExpanded(false)}
                title="Collapse sidebar"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/50 dark:hover:bg-white/10"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {isTablet && isCollapsedRail && (
        <div className="py-2 flex flex-col items-center gap-1 border-b border-slate-200/70 dark:border-white/10">
          <button
            type="button"
            onClick={() => setTabletExpanded(true)}
            title="Expand sidebar"
            className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200/50 dark:hover:bg-white/10"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            title="Toggle theme"
            className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200/50 dark:hover:bg-white/10"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      )}

      {/* Active Document Context */}
      {!isCollapsedRail && (
        <div className="px-3 py-3 border-b border-slate-200/70 dark:border-white/10">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Active Document
            </span>
            {activeProject && (
              <button
                type="button"
                onClick={onCloseProject}
                title="Close active project"
                className="text-[11px] text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-0.5"
              >
                <X className="w-3 h-3" />
                Close
              </button>
            )}
          </div>
          {activeProject ? (
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {activeProject.name}
            </div>
          ) : (
            <div className="text-xs text-slate-400 dark:text-slate-500">
              No project loaded
            </div>
          )}
          {activeProject && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              <span>{activeProject.pageCount} pg</span>
              <span aria-hidden="true">·</span>
              <span>{activeProject.elements.length} el</span>
              <span aria-hidden="true">·</span>
              <span>v{activeProject.version}</span>
            </div>
          )}
        </div>
      )}

      {/* Primary Navigation */}
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
              className={`w-full ${
                workspaceLayout === 'compact' ? 'min-h-[34px] py-1.5' : 'min-h-[38px] py-2'
              } flex items-center ${
                isCollapsedRail ? 'justify-center px-0' : 'gap-2.5 px-3'
              } rounded-xl text-[13px] font-medium transition-[background-color,color,border-color] duration-150 whitespace-nowrap shrink-0 border ${
                isActive
                  ? 'bg-blue-600/14 text-blue-700 border-blue-500/30 dark:bg-blue-500/18 dark:text-blue-300 dark:border-blue-400/25 shadow-xs'
                  : disabled
                  ? 'border-transparent text-slate-400 dark:text-slate-600 cursor-not-allowed'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/8'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!isCollapsedRail && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom Workspace Info */}
      {!isCollapsedRail && (
        <div className="px-4 py-3 border-t border-slate-200/70 dark:border-white/10 text-[11px] text-slate-500 dark:text-slate-400">
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
    </aside>
  );
};
