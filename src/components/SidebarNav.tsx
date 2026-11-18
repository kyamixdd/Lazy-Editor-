import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  Files,
  Layers,
  LayoutDashboard,
  Menu,
  Moon,
  PenTool,
  Printer,
  Settings,
  Sun,
  Table2,
  X,
} from 'lucide-react';
import { useViewport } from '../hooks/useViewport';
import { NavSection, PDFProject } from '../types/pdfStudio';

interface SidebarNavProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  activeProject: PDFProject | null;
  onCloseProject: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresProject?: boolean;
}> = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard },
  { id: 'new-project', label: 'New PDF Project', shortLabel: 'Upload', icon: FilePlus2 },
  { id: 'templates', label: 'My Templates', shortLabel: 'Templates', icon: Layers },
  { id: 'editor', label: 'PDF Editor', shortLabel: 'Editor', icon: PenTool, requiresProject: true },
  {
    id: 'bulk-generator',
    label: 'Bulk Generator',
    shortLabel: 'Bulk',
    icon: Printer,
    requiresProject: true,
  },
  {
    id: 'data-manager',
    label: 'Data Manager',
    shortLabel: 'Data',
    icon: Table2,
    requiresProject: true,
  },
  {
    id: 'export-center',
    label: 'Export Center',
    shortLabel: 'Export',
    icon: Download,
    requiresProject: true,
  },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

const MOBILE_BOTTOM_TABS: NavSection[] = [
  'dashboard',
  'new-project',
  'editor',
  'bulk-generator',
  'export-center',
];

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeSection,
  onSelectSection,
  activeProject,
  onCloseProject,
  theme,
  onToggleTheme,
}) => {
  const { isMobile, isTablet } = useViewport();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [tabletExpanded, setTabletExpanded] = useState(false);

  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeSection);

  const handleNavClick = (id: NavSection, disabled?: boolean) => {
    if (disabled) return;
    onSelectSection(id);
    setMobileDrawerOpen(false);
  };

  // MOBILE NAVIGATION (< 768px): Compact 52px Top App Bar + Slide-Out Drawer + Bottom Thumb Bar (outside editor)
  if (isMobile) {
    const showBottomBar = activeSection !== 'editor';

    return (
      <>
        <header className="sticky top-0 z-40 h-13 px-3 flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#0E131D]/95 backdrop-blur-md pt-safe shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="min-h-[44px] min-w-[44px] -ml-1.5 flex items-center justify-center rounded-md text-slate-700 dark:text-slate-200 active:bg-slate-100 dark:active:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                {activeSection === 'editor' && activeProject
                  ? activeProject.name
                  : activeNavItem?.label || 'PDF Studio AI'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {activeSection !== 'new-project' && activeSection !== 'editor' && (
              <button
                type="button"
                onClick={() => onSelectSection('new-project')}
                className="min-h-[38px] px-3 rounded-md bg-blue-600 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                Upload PDF
              </button>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle color theme"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-slate-600 dark:text-slate-300"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        {/* Slide-Out Mobile Drawer */}
        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 flex">
            <div
              onClick={() => setMobileDrawerOpen(false)}
              className="fixed inset-0 bg-black/55 backdrop-blur-xs"
            />
            <aside className="relative w-72 max-w-[84vw] h-full bg-white dark:bg-[#0E131D] border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl z-10">
              <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center">
                    <Files className="w-4 h-4" />
                  </div>
                  <span className="font-display font-semibold text-sm text-slate-900 dark:text-slate-100">
                    PDF Studio AI
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
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
                      className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-600/12 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                          : disabled
                          ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed'
                          : 'text-slate-700 dark:text-slate-300 active:bg-slate-100 dark:active:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}

        {/* Fixed Thumb Bottom Navigation (hidden in Editor so Editor owns bottom toolbar) */}
        {showBottomBar && (
          <nav
            aria-label="Primary mobile navigation"
            className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0E131D]/95 backdrop-blur-md pb-safe"
          >
            <div className="grid grid-cols-5 h-14">
              {MOBILE_BOTTOM_TABS.map((tabId) => {
                const item = NAV_ITEMS.find((n) => n.id === tabId)!;
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const disabled = Boolean(item.requiresProject && !activeProject);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleNavClick(item.id, disabled)}
                    className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                      isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : disabled
                        ? 'text-slate-400 dark:text-slate-600'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="truncate max-w-full px-1">{item.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </>
    );
  }

  // TABLET (768px - 1199px) & DESKTOP (>= 1200px) SIDEBAR
  const isCollapsedRail = isTablet && !tabletExpanded;

  return (
    <aside
      className={`${
        isCollapsedRail ? 'w-16' : 'w-60'
      } shrink-0 h-screen sticky top-0 flex flex-col border-r border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0E131D] select-none transition-[width] duration-150`}
    >
      {/* Brand header */}
      <div className="h-14 px-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/90">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-md bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Files className="w-4 h-4" />
          </div>
          {!isCollapsedRail && (
            <span className="font-display font-semibold text-sm tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap truncate">
              PDF Studio AI
            </span>
          )}
        </div>
        {!isCollapsedRail && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle color theme"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/80 transition-colors"
            >
              {theme === 'dark' ? (
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
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {isTablet && isCollapsedRail && (
        <div className="py-2 flex flex-col items-center gap-1 border-b border-slate-200 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setTabletExpanded(true)}
            title="Expand sidebar"
            className="w-10 h-10 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            title="Toggle theme"
            className="w-10 h-10 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      )}

      {/* Active Document Context */}
      {!isCollapsedRail && (
        <div className="px-3 py-3 border-b border-slate-200 dark:border-slate-800/80">
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
            <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
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
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
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
              className={`w-full min-h-[40px] flex items-center ${
                isCollapsedRail ? 'justify-center px-0' : 'gap-2.5 px-3'
              } py-2 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-blue-600/12 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                  : disabled
                  ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/60'
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
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
          {activeProject ? (
            <div className="flex items-center justify-between tabular-nums">
              <span>{activeProject.pageConfig.sizePreset}</span>
              <span>
                {Math.round(activeProject.pageConfig.widthPt)}×
                {Math.round(activeProject.pageConfig.heightPt)} pt
              </span>
            </div>
          ) : (
            <span>Ready for PDF import</span>
          )}
        </div>
      )}
    </aside>
  );
};
