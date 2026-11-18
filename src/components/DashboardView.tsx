import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Download,
  FilePlus2,
  FolderHeart,
  FolderOpen,
  HardDrive,
  Layers,
  ListChecks,
  PenTool,
  Plus,
  Printer,
  Star,
  Table2,
  Trash2,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import {
  MOTION_DURATION,
  MOTION_EASE,
  hasPlayedDashboardIntro,
  markDashboardIntroPlayed,
  staggerContainerVariants,
  staggerItemVariants,
} from '../config/motionSystem';
import { BatchJob, NavSection, PDFProject } from '../types/pdfStudio';
import {
  estimateStorageUsage,
  formatBytesCompact,
  StorageUsageInfo,
} from '../utils/projectStorage';
import {
  GlassButton,
  GlassCard,
  GlassFloatingActionButton,
  GlassSearchBar,
} from './glass';

interface DashboardViewProps {
  projects: PDFProject[];
  activeProject: PDFProject | null;
  batchJobs?: BatchJob[];
  onNavigate: (section: NavSection) => void;
  onOpenProject: (project: PDFProject) => void;
  onDeleteProject: (id: string) => void;
  onToggleFavorite?: (project: PDFProject) => void;
}

function getGreeting(): string {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  projects,
  activeProject,
  batchJobs = [],
  onNavigate,
  onOpenProject,
  onDeleteProject,
  onToggleFavorite,
}) => {
  const [storageInfo, setStorageInfo] = useState<StorageUsageInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const prefersReduced = useReducedMotion();
  const shouldPlayIntroRef = useRef<boolean>(!hasPlayedDashboardIntro());

  useEffect(() => {
    markDashboardIntroPlayed();
  }, []);

  useEffect(() => {
    void estimateStorageUsage(projects).then(setStorageInfo);
  }, [projects]);

  const query = searchQuery.trim().toLowerCase();

  const filteredProjects = useMemo(() => {
    if (!query) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.sourcePdfName.toLowerCase().includes(query) ||
        (p.description || '').toLowerCase().includes(query)
    );
  }, [projects, query]);

  const favoriteAndTemplates = useMemo(() => {
    const base = filteredProjects.filter((p) => p.isFavorite || p.isTemplate);
    return [...base].sort((a, b) => {
      if (Boolean(a.isFavorite) !== Boolean(b.isFavorite)) {
        return a.isFavorite ? -1 : 1;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [filteredProjects]);

  const recentExportActivity = useMemo(() => {
    const items = batchJobs
      .filter((job) => {
        if (!query) return true;
        return (
          job.projectName.toLowerCase().includes(query) ||
          (job.outputFileName || '').toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
    return items;
  }, [batchJobs, query]);

  const templatesCount = projects.filter((p) => p.isTemplate).length;
  const favoritesCount = projects.filter((p) => p.isFavorite).length;
  const totalRecords = projects.reduce((acc, p) => acc + p.dataRows.length, 0);
  const storagePercent = storageInfo?.percentUsed ?? 0;

  const animateIntro = shouldPlayIntroRef.current && !prefersReduced;

  return (
    <motion.div
      variants={staggerContainerVariants}
      initial={animateIntro ? 'hidden' : false}
      animate="visible"
      className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-5 tablet:space-y-6"
    >
      {/* Greeting & Primary Create Header */}
      <motion.div
        variants={staggerItemVariants}
        className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12"
      >
        <div>
          <div className="text-xs font-medium tracking-wide uppercase text-[#888888] dark:text-[#858585]">
            {getGreeting()} · Lazy Editor Studio
          </div>
          <h1 className="mt-1 text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
            PDF Studio AI Workspace
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Scan PDFs locally with zero AI credits required, edit exact layouts, impose multi-copy grids, and export bulk serials.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {activeProject && (
            <GlassButton
              variant="glass"
              onClick={() => onNavigate('editor')}
            >
              <PenTool className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
              Resume Editor
            </GlassButton>
          )}
          <GlassFloatingActionButton
            size="md"
            icon={<Plus className="w-4 h-4" />}
            label="Create New PDF"
            onClick={() => onNavigate('new-project')}
          />
        </div>
      </motion.div>

      {/* Floating Glass Search Bar */}
      <motion.div variants={staggerItemVariants}>
        <GlassSearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search projects, templates, or recent exports..."
        />
      </motion.div>

      {/* Quick Actions Strip */}
      <motion.div
        variants={staggerItemVariants}
        className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar snap-x"
      >
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() => onNavigate('new-project')}
        >
          <FilePlus2 className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
          Scan & Upload PDF
        </GlassButton>
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() =>
            activeProject
              ? onNavigate('bulk-generator')
              : onNavigate('new-project')
          }
        >
          <Printer className="w-3.5 h-3.5 text-[#555555] dark:text-[#B5B5B5]" />
          Bulk & Multi-Copy
        </GlassButton>
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() =>
            activeProject
              ? onNavigate('data-manager')
              : onNavigate('new-project')
          }
        >
          <Table2 className="w-3.5 h-3.5 text-[#555555] dark:text-[#B5B5B5]" />
          Data Merge
        </GlassButton>
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() => onNavigate('batch-center')}
        >
          <ListChecks className="w-3.5 h-3.5 text-[#555555] dark:text-[#B5B5B5]" />
          Batch Center
        </GlassButton>
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() => onNavigate('asset-library')}
        >
          <FolderHeart className="w-3.5 h-3.5 text-[#555555] dark:text-[#B5B5B5]" />
          Asset Library
        </GlassButton>
      </motion.div>

      {/* Responsive Metrics & Storage Usage Indicator */}
      <motion.div
        variants={staggerItemVariants}
        className="grid grid-cols-2 desktop:grid-cols-4 gap-3 tablet:gap-4"
      >
        <GlassCard level={3} padding="md">
          <div className="text-[11px] tablet:text-xs text-[#555555] dark:text-[#B5B5B5]">
            Projects
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-[#101010] dark:text-white tabular-nums">
            {projects.length}
          </div>
          <div className="mt-0.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
            {favoritesCount} starred
          </div>
        </GlassCard>

        <GlassCard level={3} padding="md">
          <div className="text-[11px] tablet:text-xs text-[#555555] dark:text-[#B5B5B5]">
            Templates
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-[#101010] dark:text-white tabular-nums">
            {templatesCount}
          </div>
          <div className="mt-0.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
            Reusable layouts
          </div>
        </GlassCard>

        <GlassCard level={3} padding="md">
          <div className="text-[11px] tablet:text-xs text-[#555555] dark:text-[#B5B5B5]">
            Dataset Rows
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-[#101010] dark:text-white tabular-nums">
            {totalRecords}
          </div>
          <div className="mt-0.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
            CSV / XLSX ready
          </div>
        </GlassCard>

        <GlassCard level={3} padding="md">
          <div className="flex items-center justify-between text-[11px] tablet:text-xs text-[#555555] dark:text-[#B5B5B5]">
            <span>Local Storage</span>
            <HardDrive className="w-3.5 h-3.5 text-[#888888] dark:text-[#858585]" />
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-[#101010] dark:text-white tabular-nums">
            {storageInfo ? storageInfo.formattedUsed : '0 KB'}
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-black/10 dark:bg-white/12 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[#101010] dark:bg-white"
              initial={false}
              animate={{ width: `${Math.max(4, Math.min(100, storagePercent || 6))}%` }}
              transition={{ duration: MOTION_DURATION.slow, ease: MOTION_EASE.liquid }}
            />
          </div>
          {storageInfo?.formattedQuota && (
            <div className="mt-1 text-[10px] text-[#888888] dark:text-[#858585] tabular-nums truncate">
              {storagePercent}% of {storageInfo.formattedQuota}
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* Horizontal Smooth-Scroll Recent Projects Carousel */}
      {filteredProjects.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-[#101010] dark:text-white">
              Recent Projects
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('templates')}
              className="text-xs font-medium text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white py-1 px-2 flex items-center gap-1 transition-colors"
            >
              Manage All
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x no-scrollbar">
            {filteredProjects.slice(0, 10).map((project) => {
              const thumb = project.originalPages[0]?.previewImageDataUrl;
              return (
                <GlassCard
                  key={project.id}
                  level={3}
                  interactive
                  padding="sm"
                  className="snap-start shrink-0 w-52 tablet:w-56 flex flex-col justify-between gap-2.5"
                  onClick={() => {
                    onOpenProject(project);
                    onNavigate('editor');
                  }}
                >
                  <div className="relative h-28 rounded-xl bg-white border border-black/10 dark:border-white/12 flex items-center justify-center overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={project.name}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Layers className="w-6 h-6 text-[#888888]" />
                    )}
                    {onToggleFavorite && (
                      <button
                        type="button"
                        aria-label={
                          project.isFavorite
                            ? 'Remove from favorites'
                            : 'Star as favorite'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(project);
                        }}
                        className="absolute top-1.5 right-1.5 min-w-[34px] min-h-[34px] rounded-xl bg-white/90 dark:bg-[#111111]/85 border border-black/10 dark:border-white/15 flex items-center justify-center text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white transition-colors"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            project.isFavorite
                              ? 'fill-[#101010] text-[#101010] dark:fill-white dark:text-white'
                              : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#101010] dark:text-white truncate">
                      {project.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums truncate">
                      {project.pageCount} pg · {project.elements.length} el ·{' '}
                      {project.pageConfig.sizePreset}
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Favorite & Saved Templates */}
      {favoriteAndTemplates.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-[#101010] dark:text-white">
              Favorite & Saved Templates
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('templates')}
              className="text-xs font-medium text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white py-1 px-2 transition-colors"
            >
              View Library
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x no-scrollbar">
            {favoriteAndTemplates.slice(0, 8).map((tpl) => {
              const thumb = tpl.originalPages[0]?.previewImageDataUrl;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    onOpenProject(tpl);
                    onNavigate('editor');
                  }}
                  className="snap-start shrink-0 w-44 rounded-2xl border glass-level-3 glass-interactive p-2.5 text-left"
                >
                  <div className="h-22 rounded-xl bg-white flex items-center justify-center overflow-hidden mb-2 border border-black/10">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={tpl.name}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Layers className="w-6 h-6 text-[#888888]" />
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-[#101010] dark:text-white truncate">
                      {tpl.name}
                    </span>
                    {tpl.isFavorite && (
                      <Star className="w-3 h-3 fill-[#101010] text-[#101010] dark:fill-white dark:text-white shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                    {tpl.pageCount} pg · v{tpl.version}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Two-Column Desktop Split: All Projects List + Recent Export Activity */}
      <motion.div
        variants={staggerItemVariants}
        className="grid grid-cols-1 desktop:grid-cols-12 gap-4 tablet:gap-5"
      >
        {/* Recent Projects Directory */}
        <GlassCard
          level={3}
          padding="none"
          className="desktop:col-span-8 overflow-hidden"
        >
          <div className="px-4 tablet:px-5 py-3.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-[#101010] dark:text-white">
              All Projects
            </h2>
            <span className="text-xs text-[#888888] dark:text-[#858585] tabular-nums">
              {filteredProjects.length} shown
            </span>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="p-8 tablet:p-10 text-center">
              <FolderOpen className="w-8 h-8 text-[#888888] dark:text-[#858585] mx-auto mb-3" />
              <div className="text-sm font-medium text-[#101010] dark:text-white">
                {query ? 'No matching projects found' : 'No PDF projects yet'}
              </div>
              <p className="mt-1 text-xs text-[#555555] dark:text-[#B5B5B5] max-w-sm mx-auto">
                {query
                  ? 'Try clearing or refining your search query.'
                  : 'Upload an existing PDF document or create a blank/sample invoice or receipt document to begin editing.'}
              </p>
              {!query && (
                <div className="mt-4 flex justify-center">
                  <GlassButton
                    variant="primary"
                    onClick={() => onNavigate('new-project')}
                  >
                    Upload PDF / Create Project
                  </GlassButton>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Mobile Tap List */}
              <div className="divide-y divide-black/10 dark:divide-white/10 tablet:hidden">
                {filteredProjects.slice(0, 10).map((project) => (
                  <div
                    key={project.id}
                    className="p-3.5 flex items-center justify-between gap-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProject(project);
                        onNavigate('editor');
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="text-sm font-medium text-[#101010] dark:text-white truncate">
                        {project.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#888888] dark:text-[#858585] tabular-nums">
                        <span>{project.pageCount} pg</span>
                        <span aria-hidden="true">·</span>
                        <span>{project.elements.length} el</span>
                        <span aria-hidden="true">·</span>
                        <span>{project.pageConfig.sizePreset}</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenProject(project);
                          onNavigate('editor');
                        }}
                        className="min-h-[44px] px-3 rounded-xl text-xs font-medium bg-[#101010] text-white dark:bg-white dark:text-[#050505]"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProject(project.id)}
                        aria-label={`Delete ${project.name}`}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tablet & Desktop Table */}
              <div className="hidden tablet:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-black/10 dark:border-white/12 text-[11px] font-medium text-[#888888] dark:text-[#858585]">
                      <th className="py-2.5 px-4 w-8" aria-label="Favorite" />
                      <th className="py-2.5 px-3">Project Name</th>
                      <th className="py-2.5 px-3 text-right">Pages</th>
                      <th className="py-2.5 px-3 text-right">Elements</th>
                      <th className="py-2.5 px-3">Updated</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/8 dark:divide-white/8 text-xs">
                    {filteredProjects.slice(0, 12).map((project) => (
                      <tr
                        key={project.id}
                        className="hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
                      >
                        <td className="py-2.5 pl-4 pr-1">
                          {onToggleFavorite && (
                            <button
                              type="button"
                              onClick={() => onToggleFavorite(project)}
                              aria-label="Toggle favorite"
                              className="p-1 text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  project.isFavorite
                                    ? 'fill-[#101010] text-[#101010] dark:fill-white dark:text-white'
                                    : ''
                                }`}
                              />
                            </button>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-[#101010] dark:text-white">
                          <button
                            type="button"
                            onClick={() => {
                              onOpenProject(project);
                              onNavigate('editor');
                            }}
                            className="hover:underline text-left truncate max-w-[220px] block"
                          >
                            {project.name}
                          </button>
                          <div className="text-[11px] font-normal text-[#888888] dark:text-[#858585] truncate max-w-[220px]">
                            {project.sourcePdfName}
                            {project.isTemplate ? ' · Template' : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                          {project.pageCount}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                          {project.elements.length}
                        </td>
                        <td className="py-2.5 px-3 text-[#888888] dark:text-[#858585] tabular-nums whitespace-nowrap">
                          {new Date(project.updatedAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onOpenProject(project);
                                onNavigate('editor');
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-[#101010] hover:text-white dark:hover:bg-white dark:hover:text-[#050505] transition-colors"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteProject(project.id)}
                              aria-label={`Delete ${project.name}`}
                              className="p-1.5 rounded-lg text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </GlassCard>

        {/* Recent Export Activity */}
        <GlassCard
          level={3}
          padding="none"
          className="desktop:col-span-4 overflow-hidden flex flex-col"
        >
          <div className="px-4 tablet:px-5 py-3.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-[#101010] dark:text-white">
              Recent Export Activity
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('batch-center')}
              className="text-xs font-medium text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white transition-colors"
            >
              Queue
            </button>
          </div>

          {recentExportActivity.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#888888] dark:text-[#858585] flex-1 flex flex-col items-center justify-center">
              <Download className="w-6 h-6 text-[#888888] dark:text-[#858585] mb-2" />
              <div className="text-[#555555] dark:text-[#B5B5B5]">No exports recorded yet</div>
              <div className="mt-1 text-[11px] text-[#888888] dark:text-[#858585]">
                Exported PDFs and batch jobs appear here automatically.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-black/8 dark:divide-white/8">
              {recentExportActivity.map((job) => (
                <div
                  key={job.id}
                  className="px-4 py-3 flex items-start justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[#101010] dark:text-white truncate">
                      {job.outputFileName || job.projectName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums truncate">
                      {job.status}
                      {job.outputSizeBytes
                        ? ` · ${formatBytesCompact(job.outputSizeBytes)}`
                        : ''}
                      {' · '}
                      {new Date(job.completedAt || job.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-medium capitalize shrink-0 ${
                      job.status === 'failed'
                        ? 'text-[#101010] dark:text-white underline decoration-dotted'
                        : 'text-[#555555] dark:text-[#B5B5B5]'
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </motion.div>
    </motion.div>
  );
};
