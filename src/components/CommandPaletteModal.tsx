import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Command,
  FileText,
  GitBranch,
  LayoutTemplate,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  modalBackdropVariants,
  modalPanelVariants,
} from '../config/motionSystem';
import {
  NavSection,
  PDFProject,
  ProductionBlueprint,
  TemplateAutomationProfile,
  WorkflowChain,
} from '../types/pdfStudio';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: PDFProject[];
  blueprints: ProductionBlueprint[];
  profiles: TemplateAutomationProfile[];
  workflows: WorkflowChain[];
  activeProject: PDFProject | null;
  resolvedTheme: 'dark' | 'light';
  onToggleTheme: () => void;
  onNavigate: (section: NavSection) => void;
  onOpenProject: (project: PDFProject) => void;
}

interface PaletteEntry {
  id: string;
  category: 'Navigation' | 'Project' | 'Blueprint' | 'Template Profile' | 'Workflow' | 'Action';
  title: string;
  subtitle: string;
  searchBlob: string;
  icon: React.ComponentType<{ className?: string }>;
  onExecute: () => void;
}

const NAV_COMMANDS: Array<{ id: NavSection; label: string; desc: string; requiresProject?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', desc: 'Workspace overview & recent projects' },
  { id: 'new-project', label: 'New PDF Project', desc: 'Upload & scan PDF locally' },
  { id: 'templates', label: 'My Templates & Projects', desc: 'Saved projects, folders, tags & DNA' },
  { id: 'editor', label: 'PDF Editor', desc: 'Visual Konva layout, text & barcode studio', requiresProject: true },
  { id: 'blueprint-studio', label: 'Production Blueprint Studio', desc: 'Visual multi-block production sheets' },
  { id: 'bulk-generator', label: 'Bulk Generator', desc: 'Multi-copy imposition & serial intelligence', requiresProject: true },
  { id: 'data-manager', label: 'Data Manager & Simulator', desc: 'CSV/Excel merge & stress test', requiresProject: true },
  { id: 'workflow-studio', label: 'Workflow Automation Studio', desc: 'Automated validation & generation chains' },
  { id: 'preflight', label: 'Preflight QC', desc: 'Inspect geometry, overflow, fonts & barcodes', requiresProject: true },
  { id: 'compare', label: 'Compare PDFs', desc: 'Original vs edited overlay diff', requiresProject: true },
  { id: 'batch-center', label: 'Batch Center & Recovery', desc: 'Queue & checkpoint resume engine' },
  { id: 'asset-library', label: 'Asset Library', desc: 'Custom fonts, logos, palettes & shapes' },
  { id: 'export-center', label: 'Export Center', desc: 'Managed batch export, ZIP & Integrity Passports', requiresProject: true },
  { id: 'pdf-utilities', label: 'PDF Utilities Toolkit', desc: 'Metadata scrub, outlines, split/merge & AcroForms' },
  { id: 'settings', label: 'Settings & Presets', desc: 'Theme, editing presets & custom shortcuts' },
];

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  projects,
  blueprints,
  profiles,
  workflows,
  activeProject,
  resolvedTheme,
  onToggleTheme,
  onNavigate,
  onOpenProject,
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const list: PaletteEntry[] = [];

    list.push({
      id: 'act-theme',
      category: 'Action',
      title: `Switch to ${resolvedTheme === 'dark' ? 'Pearl Light' : 'Obsidian Dark'} Theme`,
      subtitle: 'Toggle application appearance mode',
      searchBlob: 'theme dark light mode appearance',
      icon: resolvedTheme === 'dark' ? Sun : Moon,
      onExecute: () => {
        onToggleTheme();
        onClose();
      },
    });

    list.push({
      id: 'act-new',
      category: 'Action',
      title: 'Create New PDF Project',
      subtitle: 'Upload PDF or initialize blank layout',
      searchBlob: 'new upload create pdf project',
      icon: Plus,
      onExecute: () => {
        onNavigate('new-project');
        onClose();
      },
    });

    for (const nav of NAV_COMMANDS) {
      if (nav.requiresProject && !activeProject) continue;
      list.push({
        id: `nav-${nav.id}`,
        category: 'Navigation',
        title: nav.label,
        subtitle: nav.desc,
        searchBlob: `${nav.label} ${nav.desc} ${nav.id}`.toLowerCase(),
        icon: ArrowRight,
        onExecute: () => {
          onNavigate(nav.id);
          onClose();
        },
      });
    }

    for (const proj of projects) {
      const tagStr = (proj.tags || []).join(' ');
      const folderStr = proj.folderName || '';
      list.push({
        id: `proj-${proj.id}`,
        category: 'Project',
        title: proj.name,
        subtitle: `${proj.pageCount} pg · ${folderStr ? `Folder: ${folderStr}` : 'Unsorted'}${tagStr ? ` · #${tagStr}` : ''}`,
        searchBlob: `${proj.name} ${proj.sourcePdfName} ${folderStr} ${tagStr}`.toLowerCase(),
        icon: FileText,
        onExecute: () => {
          onOpenProject(proj);
          onNavigate('editor');
          onClose();
        },
      });
    }

    for (const bp of blueprints) {
      list.push({
        id: `bp-${bp.id}`,
        category: 'Blueprint',
        title: bp.name,
        subtitle: `${bp.blocks.length} block(s) · ${bp.sizePreset}`,
        searchBlob: `${bp.name} ${bp.description} ${(bp.tags || []).join(' ')}`.toLowerCase(),
        icon: LayoutTemplate,
        onExecute: () => {
          onNavigate('blueprint-studio');
          onClose();
        },
      });
    }

    for (const prof of profiles) {
      list.push({
        id: `prof-${prof.id}`,
        category: 'Template Profile',
        title: prof.name,
        subtitle: `${prof.pageConfig.sizePreset} · ${prof.copiesConfig.columns}×${prof.copiesConfig.rows} grid`,
        searchBlob: `${prof.name} ${prof.description}`.toLowerCase(),
        icon: Sparkles,
        onExecute: () => {
          onNavigate('templates');
          onClose();
        },
      });
    }

    for (const wf of workflows) {
      list.push({
        id: `wf-${wf.id}`,
        category: 'Workflow',
        title: wf.name,
        subtitle: `${wf.steps.length} automated step(s)`,
        searchBlob: `${wf.name} ${wf.description}`.toLowerCase(),
        icon: GitBranch,
        onExecute: () => {
          onNavigate('workflow-studio');
          onClose();
        },
      });
    }

    return list;
  }, [
    activeProject,
    blueprints,
    onClose,
    onNavigate,
    onOpenProject,
    onToggleTheme,
    profiles,
    projects,
    resolvedTheme,
    workflows,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 14);
    const terms = q.split(/\s+/).filter(Boolean);
    return entries
      .filter((e) => terms.every((t) => e.searchBlob.includes(t)))
      .slice(0, 16);
  }, [entries, query]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={onClose}
          className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-sm flex items-start justify-center pt-16 tablet:pt-24 px-4"
        >
          <motion.div
            variants={modalPanelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border glass-level-4 overflow-hidden shadow-2xl"
          >
            <div className="px-3.5 py-3 border-b border-black/10 dark:border-white/12 flex items-center gap-2.5">
              <Search className="w-4 h-4 text-[#888888] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onClose();
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursor((c) => Math.min(filtered.length - 1, c + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  } else if (e.key === 'Enter' && filtered[cursor]) {
                    e.preventDefault();
                    filtered[cursor].onExecute();
                  }
                }}
                placeholder="Jump to project, tag, blueprint, workflow, or tool..."
                className="flex-1 bg-transparent text-sm text-[#101010] dark:text-white focus:outline-none"
              />
              <span className="hidden tablet:inline-flex items-center gap-1 text-[10px] font-mono text-[#888888] px-1.5 py-0.5 rounded border border-black/15 dark:border-white/15">
                <Command className="w-2.5 h-2.5" />K
              </span>
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-black/5 dark:divide-white/5 p-1.5">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#888888]">
                  No matching projects, tools, or workflows found.
                </div>
              ) : (
                filtered.map((item, idx) => {
                  const Icon = item.icon;
                  const active = idx === cursor;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={item.onExecute}
                      className={`w-full px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-left transition-colors ${
                        active
                          ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505]'
                          : 'text-[#101010] dark:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{item.title}</div>
                          <div
                            className={`text-[11px] truncate ${
                              active ? 'opacity-80' : 'text-[#888888] dark:text-[#858585]'
                            }`}
                          >
                            {item.subtitle}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-mono uppercase shrink-0 ${
                          active ? 'opacity-85' : 'text-[#888888] dark:text-[#858585]'
                        }`}
                      >
                        {item.category}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
