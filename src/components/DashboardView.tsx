import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  FilePlus2,
  FolderOpen,
  HardDrive,
  Layers,
  PenTool,
  Printer,
  Trash2,
  Upload,
} from 'lucide-react';
import { NavSection, PDFProject } from '../types/pdfStudio';
import {
  estimateStorageUsage,
  StorageUsageInfo,
} from '../utils/projectStorage';

interface DashboardViewProps {
  projects: PDFProject[];
  activeProject: PDFProject | null;
  onNavigate: (section: NavSection) => void;
  onOpenProject: (project: PDFProject) => void;
  onDeleteProject: (id: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  projects,
  activeProject,
  onNavigate,
  onOpenProject,
  onDeleteProject,
}) => {
  const [storageInfo, setStorageInfo] = useState<StorageUsageInfo | null>(null);

  useEffect(() => {
    void estimateStorageUsage(projects).then(setStorageInfo);
  }, [projects]);

  const savedTemplates = projects.filter((p) => p.isTemplate);
  const templatesCount = savedTemplates.length;
  const totalRecords = projects.reduce((acc, p) => acc + p.dataRows.length, 0);

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-6">
      {/* Compact Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Workspace Overview
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
            Analyze PDFs with AI, edit detected layout geometry, impose copies per page, and export bulk serial documents.
          </p>
        </div>

        <div className="grid grid-cols-2 tablet:flex items-center gap-2.5 shrink-0">
          {activeProject ? (
            <button
              type="button"
              onClick={() => onNavigate('editor')}
              className="min-h-[44px] px-4 py-2 rounded-md text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap flex items-center justify-center gap-2"
            >
              <PenTool className="w-3.5 h-3.5" />
              Resume Editor
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('templates')}
              className="min-h-[44px] px-4 py-2 rounded-md text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap flex items-center justify-center gap-2"
            >
              <Layers className="w-3.5 h-3.5" />
              Templates
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('new-project')}
            className="min-h-[44px] px-4 py-2 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap flex items-center justify-center gap-2"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload / New PDF
          </button>
        </div>
      </div>

      {/* Responsive Metric & Storage Strip */}
      <div className="grid grid-cols-2 desktop:grid-cols-4 gap-3 tablet:gap-4">
        <div className="p-3.5 tablet:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            Recent Projects
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {projects.length}
          </div>
        </div>
        <div className="p-3.5 tablet:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            Template Library
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {templatesCount}
          </div>
        </div>
        <div className="p-3.5 tablet:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            Dataset Records
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {totalRecords}
          </div>
        </div>
        <div className="p-3.5 tablet:p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex items-center justify-between text-[11px] tablet:text-xs text-slate-500 dark:text-slate-400">
            <span>Local Storage</span>
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="mt-1 text-xl tablet:text-2xl font-display font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {storageInfo ? storageInfo.formattedUsed : '0 KB'}
          </div>
          {storageInfo?.formattedQuota && (
            <div className="mt-0.5 text-[10px] text-slate-400 tabular-nums truncate">
              of {storageInfo.formattedQuota} browser quota
            </div>
          )}
        </div>
      </div>

      {/* Primary Workflow Cards */}
      <div className="grid grid-cols-1 tablet:grid-cols-3 gap-3 tablet:gap-4">
        <button
          type="button"
          onClick={() => onNavigate('new-project')}
          className="text-left p-4 tablet:p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors group min-h-[44px]"
        >
          <div className="flex items-center justify-between mb-2.5">
            <FilePlus2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Upload & Analyze PDF
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Import multi-page or scanned PDFs. Extract text coordinates, blocks, and fields with Gemini AI.
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            activeProject
              ? onNavigate('bulk-generator')
              : onNavigate('new-project')
          }
          className="text-left p-4 tablet:p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors group min-h-[44px]"
        >
          <div className="flex items-center justify-between mb-2.5">
            <Printer className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Multi-Copy & Bulk Engine
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Impose custom grids per page with independent per-block serial numbering sequences.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('templates')}
          className="text-left p-4 tablet:p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors group min-h-[44px]"
        >
          <div className="flex items-center justify-between mb-2.5">
            <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Template Library
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Reopen saved templates, restore version history, or export structured JSON schemas.
          </p>
        </button>
      </div>

      {/* Template Library Quick Strip (especially handy on mobile) */}
      {savedTemplates.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Saved Templates
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('templates')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 py-1 px-2"
            >
              View All
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
            {savedTemplates.slice(0, 6).map((tpl) => {
              const thumb = tpl.originalPages[0]?.previewImageDataUrl;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    onOpenProject(tpl);
                    onNavigate('editor');
                  }}
                  className="snap-start shrink-0 w-44 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-2.5 text-left hover:border-blue-500/60 transition-colors"
                >
                  <div className="h-24 rounded bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden mb-2">
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
                  <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                    {tpl.name}
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    {tpl.pageCount} pg · v{tpl.version}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Projects Section */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="px-4 tablet:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Recent Projects & Templates
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {projects.length} total
          </span>
        </div>

        {projects.length === 0 ? (
          <div className="p-8 tablet:p-10 text-center">
            <FolderOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
              No PDF projects yet
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Upload an existing PDF document or generate a starter invoice/receipt template to begin editing.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('new-project')}
              className="mt-4 min-h-[44px] px-5 py-2 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Upload PDF / Create Project
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Tap Cards (< 768px) */}
            <div className="divide-y divide-slate-200 dark:divide-slate-800 tablet:hidden">
              {projects.slice(0, 12).map((project) => (
                <div
                  key={project.id}
                  className="p-4 flex items-center justify-between gap-3"
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
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{project.pageCount} pg</span>
                      <span aria-hidden="true">·</span>
                      <span>{project.elements.length} el</span>
                      <span aria-hidden="true">·</span>
                      <span>{project.pageConfig.sizePreset}</span>
                      {project.isTemplate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Template</span>
                        </>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProject(project);
                        onNavigate('editor');
                      }}
                      className="min-h-[44px] px-3.5 rounded-md text-xs font-medium bg-blue-600/12 text-blue-600 dark:text-blue-400"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(project.id)}
                      aria-label={`Delete ${project.name}`}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Tablet & Desktop Table (>= 768px) */}
            <div className="hidden tablet:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-5">Project Name</th>
                    <th className="py-2.5 px-4">Source File</th>
                    <th className="py-2.5 px-4 text-right">Pages</th>
                    <th className="py-2.5 px-4 text-right">Elements</th>
                    <th className="py-2.5 px-4">Updated</th>
                    <th className="py-2.5 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 text-xs">
                  {projects.slice(0, 12).map((project) => (
                    <tr
                      key={project.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-5 font-medium text-slate-900 dark:text-slate-100">
                        <button
                          type="button"
                          onClick={() => {
                            onOpenProject(project);
                            onNavigate('editor');
                          }}
                          className="hover:text-blue-600 dark:hover:text-blue-400 text-left"
                        >
                          {project.name}
                        </button>
                        {project.isTemplate && (
                          <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            · Template
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 truncate max-w-[180px]">
                        {project.sourcePdfName}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                        {project.pageCount}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300 tabular-nums">
                        {project.elements.length}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onOpenProject(project);
                              onNavigate('editor');
                            }}
                            className="px-2.5 py-1 rounded text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteProject(project.id)}
                            aria-label={`Delete ${project.name}`}
                            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10"
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
      </div>
    </div>
  );
};
