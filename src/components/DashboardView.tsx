import React, { useEffect, useMemo, useState } from 'react';
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

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-5 tablet:space-y-6">
      {/* Greeting & Primary Create Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-5 border-b border-slate-200/70 dark:border-white/10">
        <div>
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {getGreeting()} · Lazy Editor Studio
          </div>
          <h1 className="mt-0.5 text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            PDF Studio AI Workspace
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
            Scan PDFs locally with zero AI credits required, edit exact layouts, impose multi-copy grids, and export bulk serials.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {activeProject && (
            <GlassButton
              variant="glass"
              onClick={() => onNavigate('editor')}
            >
              <PenTool className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
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
      </div>

      {/* Floating Glass Search Bar */}
      <GlassSearchBar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search projects, templates, or recent exports..."
      />

      {/* Quick Actions Strip */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar snap-x">
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() => onNavigate('new-project')}
        >
          <FilePlus2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
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
          <Printer className="w-3.5 h-3.5 text-indigo-500" />
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
          <Table2 className="w-3.5 h-3.5 text-emerald-500" />
          Data Merge
        </GlassButton>
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() => onNavigate('batch-center')}
        >
          <ListChecks className="w-3.5 h-3.5 text-amber-500" />
          Batch Center
        </GlassButton>
        <GlassButton
          variant="glass"
          className="snap-start shrink-0"
          onClick={() => onNavigate('asset-library')}
        >
          <FolderHeart className="w-3.5 h-3.5 text-violet-500" />
          Asset Library
        </GlassButton>
      </div>

      {/* Responsive Metrics & Storage Usage Indicator */}
      <div className="grid grid-cols-2 desktop:grid-cols-4 gap-3 tablet:gap-4">
        <GlassCard level={3} padding="md">
          <div className="text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            Projects
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {projects.length}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {favoritesCount} starred
          </div>
        </GlassCard>

        <GlassCard level={3} padding="md">
          <div className="text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            Templates
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {templatesCount}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Reusable layouts
          </div>
        </GlassCard>

        <GlassCard level={3} padding="md">
          <div className="text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            Dataset Rows
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {totalRecords}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            CSV / XLSX ready
          </div>
        </GlassCard>

        <GlassCard level={3} padding="md">
          <div className="flex items-center justify-between text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            <span>Local Storage</span>
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {storageInfo ? storageInfo.formattedUsed : '0 KB'}
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-[width] duration-300"
              style={{ width: `${Math.max(4, Math.min(100, storagePercent || 6))}%` }}
            />
          </div>
          {storageInfo?.formattedQuota && (
            <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
              {storagePercent}% of {storageInfo.formattedQuota}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Horizontal Smooth-Scroll Recent Projects Carousel (Mobile & Quick Visual Access) */}
      {filteredProjects.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              Recent Projects
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('templates')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 py-1 px-2 flex items-center gap-1"
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
                  <div className="relative h-28 rounded-xl bg-white border border-slate-200/70 dark:border-white/10 flex items-center justify-center overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={project.name}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Layers className="w-6 h-6 text-slate-400" />
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
                        className="absolute top-1.5 right-1.5 min-w-[34px] min-h-[34px] rounded-xl bg-white/85 dark:bg-slate-900/80 border border-slate-200/70 dark:border-white/15 flex items-center justify-center text-slate-500 hover:text-amber-500 transition-colors"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            project.isFavorite
                              ? 'fill-amber-400 text-amber-400'
                              : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {project.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
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
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              Favorite & Saved Templates
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('templates')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 py-1 px-2"
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
                  <div className="h-22 rounded-xl bg-white flex items-center justify-center overflow-hidden mb-2 border border-slate-200/70">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={tpl.name}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Layers className="w-6 h-6 text-slate-400" />
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {tpl.name}
                    </span>
                    {tpl.isFavorite && (
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {tpl.pageCount} pg · v{tpl.version}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Two-Column Desktop Split: All Projects List + Recent Export Activity */}
      <div className="grid grid-cols-1 desktop:grid-cols-12 gap-4 tablet:gap-5">
        {/* Recent Projects Directory */}
        <GlassCard
          level={3}
          padding="none"
          className="desktop:col-span-8 overflow-hidden"
        >
          <div className="px-4 tablet:px-5 py-3.5 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              All Projects
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {filteredProjects.length} shown
            </span>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="p-8 tablet:p-10 text-center">
              <FolderOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {query ? 'No matching projects found' : 'No PDF projects yet'}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
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
              <div className="divide-y divide-slate-200/70 dark:divide-white/10 tablet:hidden">
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
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {project.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
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
                        className="min-h-[44px] px-3 rounded-xl text-xs font-medium bg-blue-600/14 text-blue-600 dark:text-blue-400"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProject(project.id)}
                        aria-label={`Delete ${project.name}`}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-500"
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
                    <tr className="border-b border-slate-200/70 dark:border-white/10 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-4 w-8" aria-label="Favorite" />
                      <th className="py-2.5 px-3">Project Name</th>
                      <th className="py-2.5 px-3 text-right">Pages</th>
                      <th className="py-2.5 px-3 text-right">Elements</th>
                      <th className="py-2.5 px-3">Updated</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/8 text-xs">
                    {filteredProjects.slice(0, 12).map((project) => (
                      <tr
                        key={project.id}
                        className="hover:bg-slate-200/35 dark:hover:bg-white/5 transition-colors"
                      >
                        <td className="py-2.5 pl-4 pr-1">
                          {onToggleFavorite && (
                            <button
                              type="button"
                              onClick={() => onToggleFavorite(project)}
                              aria-label="Toggle favorite"
                              className="p-1 text-slate-400 hover:text-amber-500"
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  project.isFavorite
                                    ? 'fill-amber-400 text-amber-400'
                                    : ''
                                }`}
                              />
                            </button>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              onOpenProject(project);
                              onNavigate('editor');
                            }}
                            className="hover:text-blue-600 dark:hover:text-blue-400 text-left truncate max-w-[220px] block"
                          >
                            {project.name}
                          </button>
                          <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
                            {project.sourcePdfName}
                            {project.isTemplate ? ' · Template' : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                          {project.pageCount}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                          {project.elements.length}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
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
                              className="px-2.5 py-1 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/12"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteProject(project.id)}
                              aria-label={`Delete ${project.name}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/12"
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
          <div className="px-4 tablet:px-5 py-3.5 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              Recent Export Activity
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('batch-center')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400"
            >
              Queue
            </button>
          </div>

          {recentExportActivity.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 flex-1 flex flex-col items-center justify-center">
              <Download className="w-6 h-6 text-slate-400 mb-2" />
              <div>No exports recorded yet</div>
              <div className="mt-1 text-[11px] text-slate-400">
                Exported PDFs and batch jobs appear here automatically.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200/60 dark:divide-white/8">
              {recentExportActivity.map((job) => (
                <div
                  key={job.id}
                  className="px-4 py-3 flex items-start justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {job.outputFileName || job.projectName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
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
                      job.status === 'completed'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : job.status === 'failed'
                        ? 'text-red-500'
                        : 'text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
};
