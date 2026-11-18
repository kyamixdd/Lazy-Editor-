import React, { useRef, useState } from 'react';
import {
  Copy,
  Download,
  Edit3,
  FolderOpen,
  History,
  Layers,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { NavSection, PDFProject } from '../types/pdfStudio';

interface TemplatesViewProps {
  projects: PDFProject[];
  activeProject: PDFProject | null;
  onOpenProject: (project: PDFProject) => void;
  onSaveProject: (project: PDFProject) => void;
  onDeleteProject: (id: string) => void;
  onNavigate: (section: NavSection) => void;
}

export const TemplatesView: React.FC<TemplatesViewProps> = ({
  projects,
  activeProject,
  onOpenProject,
  onSaveProject,
  onDeleteProject,
  onNavigate,
}) => {
  const [filter, setFilter] = useState<'all' | 'templates' | 'projects'>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [historyProjectId, setHistoryProjectId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const filtered = projects.filter((p) => {
    if (filter === 'templates') return p.isTemplate;
    if (filter === 'projects') return !p.isTemplate;
    return true;
  });

  const handleSaveCurrentAsTemplate = () => {
    if (!activeProject) return;
    const now = new Date().toISOString();
    const versionNote = `Saved template snapshot v${activeProject.version}`;
    const updated: PDFProject = {
      ...activeProject,
      isTemplate: true,
      version: activeProject.version + 1,
      updatedAt: now,
      versions: [
        {
          version: activeProject.version,
          savedAt: now,
          note: versionNote,
          elementsSnapshot: structuredClone(activeProject.elements),
          pageConfigSnapshot: structuredClone(activeProject.pageConfig),
        },
        ...(activeProject.versions || []),
      ],
    };
    onSaveProject(updated);
  };

  const handleDuplicate = (proj: PDFProject) => {
    const now = new Date().toISOString();
    const copy: PDFProject = {
      ...structuredClone(proj),
      id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${proj.name} (Copy)`,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    onSaveProject(copy);
  };

  const handleExportTemplateJson = (proj: PDFProject) => {
    const configOnly = {
      ...proj,
      // Keep export clean and portable
      originalPages: proj.originalPages.map((p) => ({
        ...p,
        previewImageDataUrl: undefined,
      })),
    };
    const blob = new Blob([JSON.stringify(configOnly, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${proj.name.replace(/\s+/g, '_')}_template.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplateJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PDFProject;
      if (!parsed || !Array.isArray(parsed.elements)) {
        return;
      }
      const now = new Date().toISOString();
      const imported: PDFProject = {
        ...parsed,
        id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: parsed.name ? `${parsed.name} (Imported)` : 'Imported Template',
        createdAt: now,
        updatedAt: now,
      };
      onSaveProject(imported);
    } catch (err) {
      console.error('Failed to import template JSON:', err);
    }
  };

  const historyProject = projects.find((p) => p.id === historyProjectId) || null;

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            My Templates & Projects
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
            Save analyzed PDFs as reusable templates, manage versions, duplicate configurations, or export template JSON schemas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => void handleImportTemplateJson(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="min-h-[44px] tablet:min-h-0 px-3 py-2 rounded-md text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap flex items-center gap-1.5 touch-manipulation"
          >
            <Upload className="w-3.5 h-3.5" />
            Import JSON
          </button>
          {activeProject && (
            <button
              type="button"
              onClick={handleSaveCurrentAsTemplate}
              className="min-h-[44px] tablet:min-h-0 px-3.5 py-2 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap flex items-center gap-1.5 touch-manipulation"
            >
              <Plus className="w-3.5 h-3.5" />
              Save Current as Template
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800/70 overflow-x-auto max-w-full">
          {(['all', 'templates', 'projects'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`min-h-[36px] tablet:min-h-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap touch-manipulation ${
                filter === tab
                  ? 'bg-white dark:bg-[#111827] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {tab === 'all'
                ? 'All Items'
                : tab === 'templates'
                ? 'Saved Templates'
                : 'Projects'}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {filtered.length} items
        </span>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="mt-8 p-8 tablet:p-12 text-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <Layers className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
            No matching templates or projects
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Upload a PDF in New PDF Project or import a template configuration file.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 tablet:grid-cols-2 desktop:grid-cols-3 gap-4">
          {filtered.map((proj) => {
            const isActive = activeProject?.id === proj.id;
            const thumb = proj.originalPages[0]?.previewImageDataUrl;
            return (
              <div
                key={proj.id}
                className={`rounded-lg border bg-white dark:bg-[#111827] overflow-hidden flex flex-col ${
                  isActive
                    ? 'border-blue-500'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="h-36 bg-slate-100 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-center overflow-hidden p-3">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={proj.name}
                      referrerPolicy="no-referrer"
                      className="max-h-full max-w-full object-contain rounded shadow-xs border border-slate-300 dark:border-slate-700"
                    />
                  ) : (
                    <Layers className="w-8 h-8 text-slate-400" />
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    {renamingId === proj.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (renameText.trim()) {
                            onSaveProject({
                              ...proj,
                              name: renameText.trim(),
                              updatedAt: new Date().toISOString(),
                            });
                          }
                          setRenamingId(null);
                        }}
                        className="flex gap-1.5"
                      >
                        <input
                          type="text"
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          autoFocus
                          className="flex-1 px-2 py-1 text-xs rounded border border-blue-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="submit"
                          className="px-2 py-1 text-xs rounded bg-blue-600 text-white"
                        >
                          Save
                        </button>
                      </form>
                    ) : (
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {proj.name}
                      </h3>
                    )}

                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{proj.isTemplate ? 'Template' : 'Project'}</span>
                      <span> · </span>
                      <span>v{proj.version}</span>
                      <span> · </span>
                      <span>{proj.elements.length} elements</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProject(proj);
                        onNavigate('editor');
                      }}
                      className="min-h-[40px] desktop:min-h-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Edit
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => {
                          setRenamingId(proj.id);
                          setRenameText(proj.name);
                        }}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 touch-manipulation"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Duplicate"
                        onClick={() => handleDuplicate(proj)}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 touch-manipulation"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Version history"
                        onClick={() =>
                          setHistoryProjectId(
                            historyProjectId === proj.id ? null : proj.id
                          )
                        }
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 touch-manipulation"
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Export template JSON"
                        onClick={() => handleExportTemplateJson(proj)}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 touch-manipulation"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => onDeleteProject(proj.id)}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded text-slate-500 hover:text-red-500 hover:bg-red-500/10 touch-manipulation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Version History Drawer / Panel */}
      {historyProject && (
        <div className="mt-6 p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Version History: {historyProject.name}
            </h3>
            <button
              type="button"
              onClick={() => setHistoryProjectId(null)}
              className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              Close
            </button>
          </div>
          {!historyProject.versions || historyProject.versions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No saved version snapshots yet. Use "Save Current as Template" or save a snapshot from the editor to record versions.
            </p>
          ) : (
            <div className="space-y-2">
              {historyProject.versions.map((ver) => (
                <div
                  key={ver.version}
                  className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-2.5 p-3 rounded border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      Version {ver.version}
                    </span>
                    <span className="mx-2 text-slate-400">·</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {ver.note}
                    </span>
                    <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                      {new Date(ver.savedAt).toLocaleString()} ·{' '}
                      {ver.elementsSnapshot.length} elements
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const restored: PDFProject = {
                        ...historyProject,
                        elements: structuredClone(ver.elementsSnapshot),
                        pageConfig: structuredClone(ver.pageConfigSnapshot),
                        version: historyProject.version + 1,
                        updatedAt: new Date().toISOString(),
                      };
                      onSaveProject(restored);
                      onOpenProject(restored);
                      setHistoryProjectId(null);
                    }}
                    className="min-h-[40px] tablet:min-h-0 px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 font-medium transition-colors touch-manipulation"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
