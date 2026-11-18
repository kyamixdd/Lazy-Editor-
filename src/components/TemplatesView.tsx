import React, { useRef, useState } from 'react';
import {
  Copy,
  Download,
  Edit3,
  FolderOpen,
  History,
  Layers,
  Play,
  Plus,
  Star,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  NavSection,
  PDFProject,
  ProjectVersionSnapshot,
  TemplateAutomationProfile,
} from '../types/pdfStudio';
import { buildProfileFromProject } from '../utils/templateProfileEngine';
import { GlassButton, GlassCard, GlassSegmentedControl } from './glass';
import { VersionHistoryModal } from './VersionHistoryModal';

interface TemplatesViewProps {
  projects: PDFProject[];
  activeProject: PDFProject | null;
  automationProfiles?: TemplateAutomationProfile[];
  onOpenProject: (project: PDFProject) => void;
  onSaveProject: (project: PDFProject) => void;
  onDeleteProject: (id: string) => void;
  onSaveProfile?: (profile: TemplateAutomationProfile) => void;
  onDeleteProfile?: (id: string) => void;
  onRunProfile?: (profile: TemplateAutomationProfile, openIn?: NavSection) => void;
  onApplyProfileToActive?: (profile: TemplateAutomationProfile) => void;
  onSaveSnapshot?: (project: PDFProject, note: string) => void;
  onRestoreVersion?: (project: PDFProject, snapshot: ProjectVersionSnapshot) => void;
  onNavigate: (section: NavSection) => void;
}

export const TemplatesView: React.FC<TemplatesViewProps> = ({
  projects,
  activeProject,
  automationProfiles = [],
  onOpenProject,
  onSaveProject,
  onDeleteProject,
  onSaveProfile,
  onDeleteProfile,
  onRunProfile,
  onApplyProfileToActive,
  onSaveSnapshot,
  onRestoreVersion,
  onNavigate,
}) => {
  const [filter, setFilter] = useState<
    'all' | 'favorites' | 'templates' | 'projects' | 'profiles'
  >('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [historyProjectId, setHistoryProjectId] = useState<string | null>(null);
  const lastHistoryProjectRef = useRef<PDFProject | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const filtered = projects.filter((p) => {
    if (filter === 'favorites') return Boolean(p.isFavorite);
    if (filter === 'templates') return p.isTemplate;
    if (filter === 'projects') return !p.isTemplate;
    if (filter === 'profiles') return false;
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
          fitConfigSnapshot: activeProject.fitConfig
            ? structuredClone(activeProject.fitConfig)
            : undefined,
          copiesConfigSnapshot: structuredClone(activeProject.copiesConfig),
        },
        ...(activeProject.versions || []),
      ],
    };
    onSaveProject(updated);
  };

  const handleSaveCurrentAsAutomationProfile = () => {
    if (!activeProject || !onSaveProfile) return;
    const profile = buildProfileFromProject(activeProject);
    onSaveProfile(profile);
    setFilter('profiles');
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

  const handleExportProfileJson = (profile: TemplateAutomationProfile) => {
    const clean = {
      ...profile,
      originalPages: profile.originalPages.map((p) => ({
        ...p,
        previewImageDataUrl: undefined,
      })),
    };
    const blob = new Blob([JSON.stringify(clean, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/\s+/g, '_')}_profile.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplateJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as
        | PDFProject
        | TemplateAutomationProfile;
      if (!parsed || !Array.isArray(parsed.elements)) {
        return;
      }
      const now = new Date().toISOString();
      if ('fieldMappings' in parsed && 'blockBoundaries' in parsed && onSaveProfile) {
        const importedProfile: TemplateAutomationProfile = {
          ...(parsed as TemplateAutomationProfile),
          id: `prof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: parsed.name
            ? `${parsed.name} (Imported)`
            : 'Imported Automation Profile',
          createdAt: now,
          updatedAt: now,
        };
        onSaveProfile(importedProfile);
        setFilter('profiles');
      } else {
        const imported: PDFProject = {
          ...(parsed as PDFProject),
          id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: parsed.name ? `${parsed.name} (Imported)` : 'Imported Template',
          createdAt: now,
          updatedAt: now,
        };
        onSaveProject(imported);
      }
    } catch (err) {
      console.error('Failed to import template JSON:', err);
    }
  };

  const historyProject =
    projects.find((p) => p.id === historyProjectId) || null;
  if (historyProject) {
    lastHistoryProjectRef.current = historyProject;
  }
  const modalHistoryProject = historyProject || lastHistoryProjectRef.current;

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full">
      <div className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-6 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
            My Templates & Automation Profiles
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Save analyzed PDFs as reusable templates or end-to-end automation profiles (imposition, serial rules, field mappings, and export presets).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => void handleImportTemplateJson(e.target.files?.[0])}
          />
          <GlassButton
            variant="glass"
            size="md"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="w-3.5 h-3.5" />
            Import JSON
          </GlassButton>
          {activeProject && onSaveProfile && (
            <GlassButton
              variant="glass"
              size="md"
              onClick={handleSaveCurrentAsAutomationProfile}
              className="border-black/25 dark:border-white/25 text-[#101010] dark:text-white"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Save Automation Profile
            </GlassButton>
          )}
          {activeProject && (
            <GlassButton
              variant="primary"
              size="md"
              onClick={handleSaveCurrentAsTemplate}
            >
              <Plus className="w-3.5 h-3.5" />
              Save as Template
            </GlassButton>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <GlassSegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All Items', count: projects.length },
            {
              value: 'favorites',
              label: 'Favorites',
              count: projects.filter((p) => p.isFavorite).length,
            },
            { value: 'templates', label: 'Saved Templates' },
            { value: 'projects', label: 'Projects' },
            {
              value: 'profiles',
              label: 'Automation Profiles',
              count: automationProfiles.length,
            },
          ]}
        />
        <span className="text-xs text-[#888888] dark:text-[#858585] tabular-nums shrink-0">
          {filter === 'profiles' ? automationProfiles.length : filtered.length}{' '}
          items
        </span>
      </div>

      {/* Automation Profiles View (Module 3) */}
      {filter === 'profiles' ? (
        automationProfiles.length === 0 ? (
          <GlassCard level={3} padding="lg" className="mt-8 text-center">
            <Wand2 className="w-8 h-8 text-[#888888] dark:text-[#858585] mx-auto mb-3" />
            <div className="text-sm font-medium text-[#101010] dark:text-white">
              No Automation Profiles saved yet
            </div>
            <p className="mt-1 text-xs text-[#555555] dark:text-[#B5B5B5] max-w-md mx-auto">
              Configure a project (blocks, page dimensions, imposition grid, serial numbering, data field mappings, export presets) and click &quot;Save Automation Profile&quot; to reuse the complete setup with one click.
            </p>
          </GlassCard>
        ) : (
          <div className="mt-5 grid grid-cols-1 tablet:grid-cols-2 desktop:grid-cols-3 gap-4">
            {automationProfiles.map((prof) => {
              const thumb = prof.originalPages[0]?.previewImageDataUrl;
              return (
                <GlassCard
                  key={prof.id}
                  level={3}
                  padding="none"
                  className="overflow-hidden flex flex-col"
                >
                  <div className="h-32 bg-[#F7F7F7] dark:bg-[#0B0B0B] border-b border-black/10 dark:border-white/12 flex items-center justify-center overflow-hidden p-3">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={prof.name}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain rounded shadow-xs border border-black/15 dark:border-white/15"
                      />
                    ) : (
                      <Wand2 className="w-8 h-8 text-[#888888] dark:text-[#858585]" />
                    )}
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3 text-xs">
                    <div>
                      <h3 className="text-sm font-semibold text-[#101010] dark:text-white truncate">
                        {prof.name}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] line-clamp-2">
                        {prof.description}
                      </p>
                      <div className="mt-2 space-y-0.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                        <div>
                          {prof.pageConfig.sizePreset} · {prof.pageConfig.orientation} ·{' '}
                          {prof.copiesConfig.enabled
                            ? `${prof.copiesConfig.columns}×${prof.copiesConfig.rows} grid`
                            : '1-up'}
                        </div>
                        <div>
                          {prof.blockBoundaries.length} blocks ·{' '}
                          {prof.fieldMappings.length} mapped fields ·{' '}
                          {prof.serialRules.length} serial rules
                        </div>
                        <div>
                          Export: {prof.exportConfig.mode.replace(/_/g, ' ')} ({prof.exportConfig.dpi} DPI)
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-2">
                      {onRunProfile && (
                        <button
                          type="button"
                          onClick={() => onRunProfile(prof, 'bulk-generator')}
                          className="min-h-[38px] desktop:min-h-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] flex items-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Run Profile
                        </button>
                      )}
                      <div className="flex items-center gap-1">
                        {activeProject && onApplyProfileToActive && (
                          <button
                            type="button"
                            onClick={() => onApplyProfileToActive(prof)}
                            className="px-2.5 py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[11px] font-medium text-[#101010] dark:text-white"
                          >
                            Apply to Active
                          </button>
                        )}
                        <button
                          type="button"
                          title="Export Profile JSON"
                          onClick={() => handleExportProfileJson(prof)}
                          className="p-1.5 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08]"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {onDeleteProfile && (
                          <button
                            type="button"
                            title="Delete Profile"
                            onClick={() => onDeleteProfile(prof.id)}
                            className="p-1.5 rounded-lg text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )
      ) : filtered.length === 0 ? (
        <GlassCard level={3} padding="lg" className="mt-8 text-center">
          <Layers className="w-8 h-8 text-[#888888] dark:text-[#858585] mx-auto mb-3" />
          <div className="text-sm font-medium text-[#101010] dark:text-white">
            No matching templates or projects
          </div>
          <p className="mt-1 text-xs text-[#555555] dark:text-[#B5B5B5]">
            Upload a PDF in New PDF Project or import a template configuration file.
          </p>
        </GlassCard>
      ) : (
        <div className="mt-5 grid grid-cols-1 tablet:grid-cols-2 desktop:grid-cols-3 gap-4">
          {filtered.map((proj) => {
            const isActive = activeProject?.id === proj.id;
            const thumb = proj.originalPages[0]?.previewImageDataUrl;
            return (
              <GlassCard
                key={proj.id}
                level={3}
                padding="none"
                className={`overflow-hidden flex flex-col ${
                  isActive ? 'border-[#101010]/70 ring-1 ring-black/20 dark:border-white/75 dark:ring-white/25' : ''
                }`}
              >
                <div className="relative h-36 bg-[#F7F7F7] dark:bg-[#0B0B0B] border-b border-black/10 dark:border-white/12 flex items-center justify-center overflow-hidden p-3">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={proj.name}
                      referrerPolicy="no-referrer"
                      className="max-h-full max-w-full object-contain rounded shadow-xs border border-black/15 dark:border-white/15"
                    />
                  ) : (
                    <Layers className="w-8 h-8 text-[#888888] dark:text-[#858585]" />
                  )}
                  <button
                    type="button"
                    aria-label={proj.isFavorite ? 'Remove from favorites' : 'Mark as favorite'}
                    onClick={() =>
                      onSaveProject({
                        ...proj,
                        isFavorite: !proj.isFavorite,
                      })
                    }
                    className={`absolute top-2 right-2 min-w-[36px] min-h-[36px] rounded-xl glass-level-4 border flex items-center justify-center transition-colors ${
                      proj.isFavorite
                        ? 'text-[#101010] dark:text-white border-black/30 dark:border-white/30'
                        : 'text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white'
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${proj.isFavorite ? 'fill-current' : ''}`} />
                  </button>
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
                          className="flex-1 px-2.5 py-1 text-xs rounded-lg border studio-input"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 text-xs rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium"
                        >
                          Save
                        </button>
                      </form>
                    ) : (
                      <h3 className="text-sm font-semibold text-[#101010] dark:text-white truncate">
                        {proj.name}
                      </h3>
                    )}

                    <div className="mt-1 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                      <span>{proj.isTemplate ? 'Template' : 'Project'}</span>
                      <span> · </span>
                      <span>v{proj.version}</span>
                      <span> · </span>
                      <span>{proj.elements.length} elements</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProject(proj);
                        onNavigate('editor');
                      }}
                      className="min-h-[40px] desktop:min-h-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
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
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] touch-manipulation"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Duplicate"
                        onClick={() => handleDuplicate(proj)}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] touch-manipulation"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Version history & comparison"
                        onClick={() => setHistoryProjectId(proj.id)}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] touch-manipulation"
                      >
                        <History className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Export template JSON"
                        onClick={() => handleExportTemplateJson(proj)}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] touch-manipulation"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => onDeleteProject(proj.id)}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded-lg text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] touch-manipulation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {modalHistoryProject && (
        <VersionHistoryModal
          isOpen={Boolean(historyProject)}
          project={modalHistoryProject}
          onClose={() => setHistoryProjectId(null)}
          onSaveNamedVersion={(note) => {
            if (onSaveSnapshot) {
              onSaveSnapshot(modalHistoryProject, note);
            } else {
              const now = new Date().toISOString();
              onSaveProject({
                ...modalHistoryProject,
                version: modalHistoryProject.version + 1,
                updatedAt: now,
                versions: [
                  {
                    version: modalHistoryProject.version,
                    savedAt: now,
                    note,
                    elementsSnapshot: structuredClone(modalHistoryProject.elements),
                    pageConfigSnapshot: structuredClone(modalHistoryProject.pageConfig),
                    fitConfigSnapshot: modalHistoryProject.fitConfig
                      ? structuredClone(modalHistoryProject.fitConfig)
                      : undefined,
                    copiesConfigSnapshot: structuredClone(
                      modalHistoryProject.copiesConfig
                    ),
                  },
                  ...(modalHistoryProject.versions || []),
                ],
              });
            }
          }}
          onRestoreVersion={(ver) => {
            if (onRestoreVersion) {
              onRestoreVersion(modalHistoryProject, ver);
            } else {
              const restored: PDFProject = {
                ...modalHistoryProject,
                elements: structuredClone(ver.elementsSnapshot),
                pageConfig: structuredClone(ver.pageConfigSnapshot),
                fitConfig: ver.fitConfigSnapshot
                  ? structuredClone(ver.fitConfigSnapshot)
                  : modalHistoryProject.fitConfig,
                copiesConfig: ver.copiesConfigSnapshot
                  ? structuredClone(ver.copiesConfigSnapshot)
                  : modalHistoryProject.copiesConfig,
                version: modalHistoryProject.version + 1,
                updatedAt: new Date().toISOString(),
              };
              onSaveProject(restored);
              onOpenProject(restored);
            }
            setHistoryProjectId(null);
          }}
        />
      )}
    </div>
  );
};
