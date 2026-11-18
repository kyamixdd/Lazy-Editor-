import React, { useRef, useState } from 'react';
import {
  Copy,
  Download,
  Edit3,
  Fingerprint,
  Folder,
  FolderOpen,
  History,
  Layers,
  Play,
  Plus,
  Search,
  Star,
  Tag,
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
import {
  buildProfileFromProject,
  computeTemplateDna,
} from '../utils/templateProfileEngine';
import { triggerBlobDownload } from '../utils/downloadHelper';
import { GlassButton, GlassCard, GlassSegmentedControl } from './glass';
import { TemplateDnaModal } from './TemplateDnaModal';
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
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [historyProjectId, setHistoryProjectId] = useState<string | null>(null);
  const [dnaProfileId, setDnaProfileId] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{
    kind: 'info' | 'error';
    message: string;
  } | null>(null);
  const lastHistoryProjectRef = useRef<PDFProject | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const uniqueFolders = Array.from(
    new Set(projects.map((p) => p.folderName?.trim()).filter(Boolean) as string[])
  ).sort();

  const q = searchQuery.trim().toLowerCase();
  const filtered = projects.filter((p) => {
    if (filter === 'favorites' && !p.isFavorite) return false;
    if (filter === 'templates' && !p.isTemplate) return false;
    if (filter === 'projects' && p.isTemplate) return false;
    if (filter === 'profiles') return false;
    if (selectedFolder !== 'all') {
      if (selectedFolder === '__unassigned__') {
        if (p.folderName?.trim()) return false;
      } else if ((p.folderName || '').trim() !== selectedFolder) {
        return false;
      }
    }
    if (q) {
      const hay = [
        p.name,
        p.description,
        p.folderName || '',
        ...(p.tags || []),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
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
    triggerBlobDownload(blob, `${proj.name.replace(/\s+/g, '_')}_template.json`);
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
    triggerBlobDownload(blob, `${profile.name.replace(/\s+/g, '_')}_profile.json`);
  };

  const handleImportTemplateJson = async (file: File | undefined) => {
    if (!file) return;
    setImportNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as
        | PDFProject
        | TemplateAutomationProfile;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.elements)) {
        setImportNotice({
          kind: 'error',
          message: `Invalid template/profile JSON in "${file.name}".`,
        });
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
        setImportNotice({
          kind: 'info',
          message: `Imported automation profile "${importedProfile.name}".`,
        });
      } else {
        const imported: PDFProject = {
          ...(parsed as PDFProject),
          id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: parsed.name ? `${parsed.name} (Imported)` : 'Imported Template',
          createdAt: now,
          updatedAt: now,
        };
        onSaveProject(imported);
        setImportNotice({
          kind: 'info',
          message: `Imported template "${imported.name}".`,
        });
      }
    } catch (err) {
      setImportNotice({
        kind: 'error',
        message:
          err instanceof Error
            ? `Failed to import "${file.name}": ${err.message}`
            : `Failed to import "${file.name}".`,
      });
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
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

      {importNotice && (
        <div
          className={`mt-4 px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            importNotice.kind === 'error'
              ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
              : 'border-black/15 dark:border-white/15 glass-level-3 text-[#101010] dark:text-white'
          }`}
        >
          <span>{importNotice.message}</span>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="text-[11px] font-medium hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Tabs + Folder & Tag Search */}
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
        <div className="flex flex-wrap items-center gap-2">
          {filter !== 'profiles' && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#888888]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, folder, tag..."
                  className="pl-8 pr-3 py-1.5 rounded-lg border studio-input text-xs w-48"
                />
              </div>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                aria-label="Filter by folder"
                className="px-2.5 py-1.5 rounded-lg border studio-select text-xs"
              >
                <option value="all">All Folders</option>
                <option value="__unassigned__">Unassigned</option>
                {uniqueFolders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="text-xs text-[#888888] dark:text-[#858585] tabular-nums shrink-0">
            {filter === 'profiles' ? automationProfiles.length : filtered.length}{' '}
            items
          </span>
        </div>
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
                        <div className="font-mono text-[10px] text-[#555555] dark:text-[#B5B5B5]">
                          DNA: {(prof.dna || computeTemplateDna(prof)).fingerprintHash}
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
                          title="Template DNA & Version Comparison"
                          onClick={() => setDnaProfileId(prof.id)}
                          className="p-1.5 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08]"
                        >
                          <Fingerprint className="w-3.5 h-3.5" />
                        </button>
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
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setRenamingId(null);
                            }
                          }}
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

                    {(proj.folderName || (proj.tags && proj.tags.length > 0)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {proj.folderName && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-black/15 dark:border-white/15 bg-black/[0.04] dark:bg-white/[0.06] text-[#101010] dark:text-white font-medium">
                            <Folder className="w-2.5 h-2.5" />
                            {proj.folderName}
                          </span>
                        )}
                        {(proj.tags || []).slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-black/10 dark:border-white/12 text-[#555555] dark:text-[#B5B5B5]"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}

                    {editingMetaId === proj.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const nextTags = tagsInput
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                          onSaveProject({
                            ...proj,
                            folderName: folderInput.trim() || undefined,
                            tags: nextTags.length > 0 ? nextTags : undefined,
                            updatedAt: new Date().toISOString(),
                          });
                          setEditingMetaId(null);
                        }}
                        className="mt-2.5 p-2 rounded-xl border border-black/10 dark:border-white/12 bg-[#F7F7F7] dark:bg-[#0B0B0B] space-y-1.5 text-[11px]"
                      >
                        <input
                          type="text"
                          value={folderInput}
                          onChange={(e) => setFolderInput(e.target.value)}
                          placeholder="Folder (e.g. Invoices / 2025)"
                          className="w-full px-2 py-1 rounded-lg border studio-input"
                        />
                        <input
                          type="text"
                          value={tagsInput}
                          onChange={(e) => setTagsInput(e.target.value)}
                          placeholder="Tags comma-separated (e.g. tax, duplex)"
                          className="w-full px-2 py-1 rounded-lg border studio-input"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingMetaId(null)}
                            className="px-2 py-1 rounded-lg text-[#888888] hover:text-[#101010] dark:hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="px-2.5 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium"
                          >
                            Save Organization
                          </button>
                        </div>
                      </form>
                    )}
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
                        title="Organize folder & tags"
                        onClick={() => {
                          if (editingMetaId === proj.id) {
                            setEditingMetaId(null);
                          } else {
                            setEditingMetaId(proj.id);
                            setFolderInput(proj.folderName || '');
                            setTagsInput((proj.tags || []).join(', '));
                          }
                        }}
                        className="min-h-[38px] min-w-[38px] desktop:min-h-0 desktop:min-w-0 flex items-center justify-center p-1.5 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] touch-manipulation"
                      >
                        <Tag className="w-3.5 h-3.5" />
                      </button>
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

      <TemplateDnaModal
        isOpen={Boolean(dnaProfileId)}
        profile={automationProfiles.find((p) => p.id === dnaProfileId) || null}
        activeProject={activeProject}
        onClose={() => setDnaProfileId(null)}
        onUpdateProfile={(updated) => onSaveProfile?.(updated)}
        onApplyToActive={onApplyProfileToActive}
      />
    </div>
  );
};
