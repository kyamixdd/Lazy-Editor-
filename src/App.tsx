import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import {
  bannerVariants,
  getNavigationDirection,
  reducedScreenVariants,
  screenVariants,
} from './config/motionSystem';
import { AboutView } from './components/AboutView';
import { AssetLibraryView } from './components/AssetLibraryView';
import { BatchCenterView } from './components/BatchCenterView';
import { BlueprintStudioView } from './components/BlueprintStudioView';
import { BulkGeneratorView } from './components/BulkGeneratorView';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { ComparisonView } from './components/ComparisonView';
import { DashboardView } from './components/DashboardView';
import { DataManagerView } from './components/DataManagerView';
import { EditorView } from './components/EditorView';
import { ExportCenterView } from './components/ExportCenterView';
import { NewProjectView } from './components/NewProjectView';
import { PdfUtilitiesView } from './components/PdfUtilitiesView';
import { PreflightView } from './components/PreflightView';
import { ScanInspectorView } from './components/ScanInspectorView';
import { SettingsView } from './components/SettingsView';
import { SidebarNav } from './components/SidebarNav';
import { TemplatesView } from './components/TemplatesView';
import { WorkflowStudioView } from './components/WorkflowStudioView';
import {
  AssetFontItem,
  AssetImageItem,
  AssetLibraryItem,
  AssetShapeItem,
  BatchCheckpoint,
  BatchJob,
  DocumentElement,
  DocumentIntegrityPassport,
  ExportNamingProfile,
  NavSection,
  PDFProject,
  ProductionBlueprint,
  ProjectVersionSnapshot,
  SerialBatchRecord,
  StudioSettings,
  TemplateAutomationProfile,
  UnsavedDraftRecord,
  WorkflowChain,
} from './types/pdfStudio';
import { registerBrowserFonts } from './utils/fontUtils';
import {
  appendOperationLog,
  clearAllProjectsLocal,
  clearBatchHistory,
  clearUnsavedDraft,
  deleteAsset,
  deleteBatchCheckpoint,
  deleteBatchJob,
  deleteBlueprint,
  deleteExportProfile,
  deletePassport,
  deleteProjectLocal,
  deleteSerialBatch,
  deleteTemplateProfile,
  deleteWorkflow,
  getActiveProjectId,
  listAssets,
  listBatchCheckpoints,
  listBatchJobs,
  listBlueprints,
  listExportProfiles,
  listPassports,
  listProjectsLocal,
  listSerialBatches,
  listTemplateProfiles,
  listUnsavedDrafts,
  listWorkflows,
  loadSettings,
  saveAsset,
  saveBatchCheckpoint,
  saveBatchJob,
  saveBlueprint,
  saveExportProfile,
  savePassport,
  saveProjectLocal,
  saveSerialBatch,
  saveSettings,
  saveTemplateProfile,
  saveUnsavedDraft,
  saveWorkflow,
  setActiveProjectId,
} from './utils/projectStorage';
import {
  applyProfileSettingsToProject,
  createProjectFromProfile,
} from './utils/templateProfileEngine';

export default function App() {
  const [settings, setSettings] = useState<StudioSettings>(() => loadSettings());
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  );
  const [activeSection, setActiveSectionState] = useState<NavSection>('dashboard');
  const [navDirection, setNavDirection] = useState<number>(1);
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollPositionsRef = useRef<
    Partial<Record<NavSection, { windowY: number; innerTop: number }>>
  >({});
  const prefersReduced = useReducedMotion();

  const setActiveSection = useCallback(
    (next: NavSection) => {
      setActiveSectionState((prev) => {
        if (prev === next) return prev;
        if (prev !== 'editor' && typeof window !== 'undefined') {
          const innerEl = mainRef.current?.querySelector('.overflow-y-auto') as
            | HTMLElement
            | null;
          scrollPositionsRef.current[prev] = {
            windowY: window.scrollY,
            innerTop: innerEl ? innerEl.scrollTop : 0,
          };
        }
        setNavDirection(getNavigationDirection(prev, next));
        return next;
      });
    },
    []
  );

  const [projects, setProjects] = useState<PDFProject[]>([]);
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [automationProfiles, setAutomationProfiles] = useState<
    TemplateAutomationProfile[]
  >([]);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [batchCheckpoints, setBatchCheckpoints] = useState<BatchCheckpoint[]>([]);
  const [blueprints, setBlueprints] = useState<ProductionBlueprint[]>([]);
  const [serialBatches, setSerialBatches] = useState<SerialBatchRecord[]>([]);
  const [passports, setPassports] = useState<DocumentIntegrityPassport[]>([]);
  const [exportProfiles, setExportProfiles] = useState<ExportNamingProfile[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowChain[]>([]);
  const [recoverableDrafts, setRecoverableDrafts] = useState<
    UnsavedDraftRecord[]
  >([]);
  const [activeProjectId, setActiveProjIdState] = useState<string | null>(() =>
    getActiveProjectId()
  );
  const [editorFocusTarget, setEditorFocusTarget] = useState<{
    pageNumber: number;
    elementId?: string;
    nonce: number;
  } | null>(null);

  const resolvedTheme: 'dark' | 'light' =
    settings.theme === 'system'
      ? systemDark
        ? 'dark'
        : 'light'
      : settings.theme;

  // Listen for OS color scheme changes when theme === 'system'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Sync Tailwind dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveSettings(settings);
  }, [resolvedTheme, settings]);

  // Load saved projects, assets, automation profiles, batch jobs & recoverable drafts from IndexedDB on boot
  useEffect(() => {
    void listProjectsLocal().then((items) => {
      setProjects(items);
      const savedActiveId = getActiveProjectId();
      if (savedActiveId && !items.some((p) => p.id === savedActiveId)) {
        const firstId = items[0]?.id || null;
        setActiveProjIdState(firstId);
        setActiveProjectId(firstId);
      }
    });
    void listAssets().then((loadedAssets) => {
      setAssets(loadedAssets);
      const fonts = loadedAssets.filter(
        (a): a is AssetFontItem => a.kind === 'font'
      );
      registerBrowserFonts(fonts);
    });
    void listTemplateProfiles().then(setAutomationProfiles);
    void listBatchJobs().then(setBatchJobs);
    void listBatchCheckpoints().then(setBatchCheckpoints);
    void listBlueprints().then(setBlueprints);
    void listSerialBatches().then(setSerialBatches);
    void listPassports().then(setPassports);
    void listExportProfiles().then(setExportProfiles);
    void listWorkflows().then(setWorkflows);
    void listUnsavedDrafts().then(setRecoverableDrafts);
  }, []);

  const customFonts = assets.filter(
    (a): a is AssetFontItem => a.kind === 'font'
  );

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || null;

  const handleSaveProject = async (
    updated: PDFProject
  ): Promise<{ ok: boolean; error?: string }> => {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      if (exists) {
        return prev.map((p) => (p.id === updated.id ? updated : p));
      }
      return [updated, ...prev];
    });
    try {
      await saveProjectLocal(updated);
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to persist project locally';
      console.error('Save project failed:', err);
      return { ok: false, error: message };
    }
  };

  const handleProjectCreated = (
    project: PDFProject,
    openImmediately: boolean
  ) => {
    void handleSaveProject(project);
    setActiveProjIdState(project.id);
    setActiveProjectId(project.id);
    if (openImmediately) {
      setActiveSection('editor');
    }
  };

  const handleOpenProject = (project: PDFProject) => {
    setActiveProjIdState(project.id);
    setActiveProjectId(project.id);
  };

  const handleCloseProject = () => {
    setActiveProjIdState(null);
    setActiveProjectId(null);
    if (
      activeSection === 'scan-inspector' ||
      activeSection === 'editor' ||
      activeSection === 'bulk-generator' ||
      activeSection === 'data-manager' ||
      activeSection === 'preflight' ||
      activeSection === 'compare' ||
      activeSection === 'export-center'
    ) {
      setActiveSection('dashboard');
    }
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) {
      handleCloseProject();
    }
    void deleteProjectLocal(id);
  };

  const handleSaveSnapshot = async (
    project: PDFProject,
    note: string
  ): Promise<{ ok: boolean; version?: number; error?: string }> => {
    const now = new Date().toISOString();
    const savedVersion = project.version;
    const updated = appendOperationLog(
      {
        ...project,
        version: project.version + 1,
        updatedAt: now,
        versions: [
          {
            version: savedVersion,
            savedAt: now,
            note,
            elementsSnapshot: structuredClone(project.elements),
            pageConfigSnapshot: structuredClone(project.pageConfig),
            fitConfigSnapshot: project.fitConfig
              ? structuredClone(project.fitConfig)
              : undefined,
            copiesConfigSnapshot: structuredClone(project.copiesConfig),
          },
          ...(project.versions || []),
        ].slice(0, 40),
      },
      'Save Version',
      `Saved v${savedVersion}: ${note}`
    );
    const saveRes = await handleSaveProject(updated);
    await clearUnsavedDraft(project.id);
    setRecoverableDrafts((prev) =>
      prev.filter((d) => d.projectId !== project.id)
    );
    if (!saveRes.ok) {
      return { ok: false, version: savedVersion, error: saveRes.error };
    }
    return { ok: true, version: savedVersion };
  };

  const handleRestoreVersion = (
    targetProject: PDFProject,
    snapshot: ProjectVersionSnapshot
  ) => {
    const now = new Date().toISOString();
    const restored = appendOperationLog(
      {
        ...targetProject,
        elements: structuredClone(snapshot.elementsSnapshot),
        pageConfig: structuredClone(snapshot.pageConfigSnapshot),
        fitConfig: snapshot.fitConfigSnapshot
          ? structuredClone(snapshot.fitConfigSnapshot)
          : targetProject.fitConfig,
        copiesConfig: snapshot.copiesConfigSnapshot
          ? structuredClone(snapshot.copiesConfigSnapshot)
          : targetProject.copiesConfig,
        version: targetProject.version + 1,
        updatedAt: now,
      },
      'Restore Version',
      `Restored v${snapshot.version} (${snapshot.note})`
    );
    handleSaveProject(restored);
    handleOpenProject(restored);
  };

  const handleInspectElement = (pageNumber: number, elementId?: string) => {
    setEditorFocusTarget({
      pageNumber,
      elementId,
      nonce: Date.now(),
    });
    setActiveSection('editor');
  };

  const handleTrackRecentTool = (toolId: string) => {
    setSettings((prev) => {
      const curr = prev.recentTools || [];
      const next = [toolId, ...curr.filter((t) => t !== toolId)].slice(0, 8);
      return { ...prev, recentTools: next };
    });
  };

  const handleSaveAsset = (asset: AssetLibraryItem) => {
    setAssets((prev) => {
      const next = [asset, ...prev.filter((a) => a.id !== asset.id)];
      if (asset.kind === 'font') {
        registerBrowserFonts(
          next.filter((a): a is AssetFontItem => a.kind === 'font')
        );
      }
      return next;
    });
    void saveAsset(asset);
  };

  const handleDeleteAsset = (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    void deleteAsset(id);
  };

  const handleSaveProfile = (profile: TemplateAutomationProfile) => {
    setAutomationProfiles((prev) => [
      profile,
      ...prev.filter((p) => p.id !== profile.id),
    ]);
    void saveTemplateProfile(profile);
  };

  const handleDeleteProfile = (id: string) => {
    setAutomationProfiles((prev) => prev.filter((p) => p.id !== id));
    void deleteTemplateProfile(id);
  };

  const handleRunProfile = (
    profile: TemplateAutomationProfile,
    openIn: NavSection = 'bulk-generator'
  ) => {
    const newProj = createProjectFromProfile(profile);
    handleProjectCreated(newProj, false);
    setActiveSection(openIn);
  };

  const handleApplyProfileToActive = (profile: TemplateAutomationProfile) => {
    if (!activeProject) return;
    const updated = applyProfileSettingsToProject(activeProject, profile);
    handleSaveProject(updated);
    setActiveSection('editor');
  };

  const handleSaveBatchJob = (job: BatchJob) => {
    setBatchJobs((prev) => {
      const exists = prev.some((j) => j.id === job.id);
      if (exists) return prev.map((j) => (j.id === job.id ? job : j));
      return [job, ...prev];
    });
    void saveBatchJob(job);
  };

  const handleDeleteBatchJob = (id: string) => {
    setBatchJobs((prev) => prev.filter((j) => j.id !== id));
    void deleteBatchJob(id);
  };

  const handleClearBatchHistory = () => {
    setBatchJobs([]);
    void clearBatchHistory();
  };

  const handleSaveBlueprint = (bp: ProductionBlueprint) => {
    setBlueprints((prev) => [bp, ...prev.filter((x) => x.id !== bp.id)]);
    void saveBlueprint(bp);
  };

  const handleDeleteBlueprint = (id: string) => {
    setBlueprints((prev) => prev.filter((x) => x.id !== id));
    void deleteBlueprint(id);
  };

  const handleSaveSerialBatch = (record: SerialBatchRecord) => {
    setSerialBatches((prev) => [record, ...prev.filter((x) => x.id !== record.id)]);
    void saveSerialBatch(record);
  };

  const handleDeleteSerialBatch = (id: string) => {
    setSerialBatches((prev) => prev.filter((x) => x.id !== id));
    void deleteSerialBatch(id);
  };

  const handleSavePassport = (passport: DocumentIntegrityPassport) => {
    setPassports((prev) => [passport, ...prev.filter((x) => x.id !== passport.id)]);
    void savePassport(passport);
  };

  const handleDeletePassport = (id: string) => {
    setPassports((prev) => prev.filter((x) => x.id !== id));
    void deletePassport(id);
  };

  const handleSaveExportProfile = (profile: ExportNamingProfile) => {
    setExportProfiles((prev) => [profile, ...prev.filter((x) => x.id !== profile.id)]);
    void saveExportProfile(profile);
  };

  const handleDeleteExportProfile = (id: string) => {
    setExportProfiles((prev) => prev.filter((x) => x.id !== id));
    void deleteExportProfile(id);
  };

  const handleSaveCheckpoint = (cp: BatchCheckpoint) => {
    setBatchCheckpoints((prev) => [cp, ...prev.filter((x) => x.id !== cp.id)]);
    void saveBatchCheckpoint(cp);
  };

  const handleDeleteCheckpoint = (id: string) => {
    setBatchCheckpoints((prev) => prev.filter((x) => x.id !== id));
    void deleteBatchCheckpoint(id);
  };

  const handleSaveWorkflow = (wf: WorkflowChain) => {
    setWorkflows((prev) => [wf, ...prev.filter((x) => x.id !== wf.id)]);
    void saveWorkflow(wf);
  };

  const handleDeleteWorkflow = (id: string) => {
    setWorkflows((prev) => prev.filter((x) => x.id !== id));
    void deleteWorkflow(id);
  };

  const handleEnqueueBatch = (proj: PDFProject) => {
    const totalPages =
      proj.bulkConfig.enabled || proj.copiesConfig.enabled
        ? Math.max(1, proj.bulkConfig.totalOutputPages)
        : Math.max(1, proj.pageCount);
    const job: BatchJob = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      projectId: proj.id,
      projectName: proj.name,
      status: 'queued',
      progressCurrent: 0,
      progressTotal: totalPages,
      stage: 'Queued from Export Center',
      createdAt: new Date().toISOString(),
    };
    handleSaveBatchJob(job);
    setActiveSection('batch-center');
  };

  const handleInsertImageFromLibrary = (imgAsset: AssetImageItem) => {
    if (!activeProject) return;
    const ratio = imgAsset.naturalHeight / Math.max(1, imgAsset.naturalWidth);
    const wPt = Math.min(180, Math.max(60, imgAsset.naturalWidth * 0.4));
    const hPt = Math.max(24, wPt * ratio);
    const el: DocumentElement = {
      id: `img-${Date.now()}`,
      type: 'image',
      pageNumber: 1,
      x: 60,
      y: 60,
      width: Number(wPt.toFixed(1)),
      height: Number(hPt.toFixed(1)),
      rotation: 0,
      text: imgAsset.name,
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#111827',
      backgroundColor: 'transparent',
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: 1,
      needsReview: false,
      isUserAdded: true,
      imageDataUrl: imgAsset.dataUrl,
      imageNaturalWidth: imgAsset.naturalWidth,
      imageNaturalHeight: imgAsset.naturalHeight,
    };
    const updated = appendOperationLog(
      {
        ...activeProject,
        elements: [...activeProject.elements, el],
        updatedAt: new Date().toISOString(),
      },
      'Insert Library Image',
      `Inserted "${imgAsset.name}" into Page 1`
    );
    handleSaveProject(updated);
    handleInspectElement(1, el.id);
  };

  const handleInsertShapeFromLibrary = (shapeAsset: AssetShapeItem) => {
    if (!activeProject) return;
    const el: DocumentElement = {
      id: `shp-${Date.now()}`,
      type: shapeAsset.shapeKind === 'line' ? 'line' : 'shape',
      shapeKind: shapeAsset.shapeKind,
      pageNumber: 1,
      x: 72,
      y: 90,
      width: shapeAsset.width,
      height: shapeAsset.height,
      rotation: 0,
      text: shapeAsset.name,
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: shapeAsset.borderColor,
      backgroundColor: shapeAsset.backgroundColor,
      borderColor: shapeAsset.borderColor,
      borderWidth: shapeAsset.borderWidth,
      align: 'left',
      opacity: shapeAsset.opacity,
      editable: true,
      locked: false,
      visible: true,
      confidence: 1,
      needsReview: false,
      isUserAdded: true,
    };
    const updated = appendOperationLog(
      {
        ...activeProject,
        elements: [...activeProject.elements, el],
        updatedAt: new Date().toISOString(),
      },
      'Insert Library Shape',
      `Inserted "${shapeAsset.name}" into Page 1`
    );
    handleSaveProject(updated);
    handleInspectElement(1, el.id);
  };

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToggleFavoriteProject = (proj: PDFProject) => {
    const updated: PDFProject = {
      ...proj,
      isFavorite: !proj.isFavorite,
    };
    handleSaveProject(updated);
  };

  const handleClearWorkspace = () => {
    void clearAllProjectsLocal().then(() => {
      setProjects([]);
      setRecoverableDrafts([]);
      setActiveProjIdState(null);
      setActiveProjectId(null);
      setActiveSection('dashboard');
    });
  };

  const visibleDrafts = recoverableDrafts.filter((d) =>
    projects.some((p) => p.id === d.projectId)
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-[100dvh] flex flex-col tablet:flex-row studio-ambient-bg text-[#101010] dark:text-white">
        <SidebarNav
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          activeProject={activeProject}
          onCloseProject={handleCloseProject}
          theme={settings.theme}
          resolvedTheme={resolvedTheme}
          onToggleTheme={() =>
            setSettings((s) => ({
              ...s,
              theme: resolvedTheme === 'dark' ? 'light' : 'dark',
            }))
          }
          widthPx={settings.navSidebarWidthPx}
          workspaceLayout={settings.workspaceLayout}
          mobileDrawerOpen={mobileDrawerOpen}
          onMobileDrawerOpenChange={setMobileDrawerOpen}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />

        <main
          ref={mainRef}
          className={`flex-1 flex flex-col min-w-0 ${
            activeSection === 'editor'
              ? 'h-[100dvh] overflow-hidden'
              : 'min-h-[calc(100dvh-48px)] tablet:min-h-screen pb-18 tablet:pb-0'
          }`}
        >
          {/* Non-intrusive Unsaved Draft Recovery Strip (Module 4) */}
          <AnimatePresence initial={false}>
            {visibleDrafts.length > 0 && activeSection !== 'editor' && (
              <motion.div
                key="draft-recovery-banner"
                variants={bannerVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="px-4 py-2 border-b border-black/10 dark:border-white/12 glass-level-2 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0"
              >
                <div className="flex items-center gap-2 text-[#101010] dark:text-white">
                  <RotateCcw className="w-3.5 h-3.5 shrink-0 text-[#555555] dark:text-[#B5B5B5]" />
                  <span>
                    Recoverable unsaved draft for{' '}
                    <strong>{visibleDrafts[0].projectName}</strong>{' '}
                    <span className="text-[#555555] dark:text-[#B5B5B5]">
                      (autosaved {new Date(visibleDrafts[0].savedAt).toLocaleTimeString()})
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const d = visibleDrafts[0];
                      handleSaveProject(d.projectSnapshot);
                      handleOpenProject(d.projectSnapshot);
                      setRecoverableDrafts((prev) =>
                        prev.filter((x) => x.projectId !== d.projectId)
                      );
                      void clearUnsavedDraft(d.projectId);
                      setActiveSection('editor');
                    }}
                    className="px-3 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium hover:opacity-90 active:scale-[0.97] transition-[opacity,transform]"
                  >
                    Restore Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = visibleDrafts[0];
                      setRecoverableDrafts((prev) =>
                        prev.filter((x) => x.projectId !== d.projectId)
                      );
                      void clearUnsavedDraft(d.projectId);
                    }}
                    className="p-1 text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white transition-colors"
                    title="Dismiss draft"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence
            mode="wait"
            custom={navDirection}
            onExitComplete={() => {
              if (activeSection !== 'editor' && typeof window !== 'undefined') {
                const saved = scrollPositionsRef.current[activeSection];
                const windowY = saved?.windowY ?? 0;
                const innerTop = saved?.innerTop ?? 0;
                requestAnimationFrame(() => {
                  window.scrollTo({ top: windowY, behavior: 'auto' });
                  const innerEl = mainRef.current?.querySelector('.overflow-y-auto') as
                    | HTMLElement
                    | null;
                  if (innerEl) {
                    innerEl.scrollTop = innerTop;
                  }
                });
              }
            }}
          >
            <motion.div
              key={activeSection}
              custom={navDirection}
              variants={prefersReduced ? reducedScreenVariants : screenVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className={`flex-1 flex flex-col min-w-0 ${
                activeSection === 'editor' ? 'h-full overflow-hidden' : ''
              }`}
            >
              {activeSection === 'dashboard' && (
                <DashboardView
                  projects={projects}
                  activeProject={activeProject}
                  batchJobs={batchJobs}
                  onNavigate={setActiveSection}
                  onOpenProject={handleOpenProject}
                  onDeleteProject={handleDeleteProject}
                  onToggleFavorite={handleToggleFavoriteProject}
                />
              )}

              {activeSection === 'new-project' && (
                <NewProjectView
                  settings={settings}
                  onProjectCreated={handleProjectCreated}
                  onUpdateProject={handleSaveProject}
                  onInspectScan={(proj) => {
                    handleProjectCreated(proj, false);
                    setActiveSection('scan-inspector');
                  }}
                />
              )}

              {activeSection === 'templates' && (
                <TemplatesView
                  projects={projects}
                  activeProject={activeProject}
                  automationProfiles={automationProfiles}
                  onOpenProject={handleOpenProject}
                  onSaveProject={handleSaveProject}
                  onDeleteProject={handleDeleteProject}
                  onSaveProfile={handleSaveProfile}
                  onDeleteProfile={handleDeleteProfile}
                  onRunProfile={handleRunProfile}
                  onApplyProfileToActive={handleApplyProfileToActive}
                  onSaveSnapshot={handleSaveSnapshot}
                  onRestoreVersion={handleRestoreVersion}
                  onNavigate={setActiveSection}
                />
              )}

              {activeSection === 'scan-inspector' && activeProject && (
                <ScanInspectorView
                  project={activeProject}
                  settings={settings}
                  onUpdateProject={handleSaveProject}
                  onInspectInEditor={handleInspectElement}
                />
              )}

              {activeSection === 'editor' && activeProject && (
                <EditorView
                  project={activeProject}
                  settings={settings}
                  assets={assets}
                  focusTarget={editorFocusTarget}
                  onUpdateProject={handleSaveProject}
                  onUpdateSettings={setSettings}
                  onSaveSnapshot={handleSaveSnapshot}
                  onRestoreVersion={(snap) =>
                    handleRestoreVersion(activeProject, snap)
                  }
                  onSaveAsset={handleSaveAsset}
                  onTrackRecentTool={handleTrackRecentTool}
                  onSaveUnsavedDraft={(draft) => void saveUnsavedDraft(draft)}
                  onNavigateSection={setActiveSection}
                  onOpenMobileNav={() => setMobileDrawerOpen(true)}
                />
              )}

              {activeSection === 'blueprint-studio' && (
                <BlueprintStudioView
                  project={activeProject}
                  blueprints={blueprints}
                  onSaveBlueprint={handleSaveBlueprint}
                  onDeleteBlueprint={handleDeleteBlueprint}
                  onUpdateProject={handleSaveProject}
                  onGoToExport={() => setActiveSection('export-center')}
                />
              )}

              {activeSection === 'bulk-generator' && activeProject && (
                <BulkGeneratorView
                  project={activeProject}
                  serialBatches={serialBatches}
                  onSaveSerialBatch={handleSaveSerialBatch}
                  onDeleteSerialBatch={handleDeleteSerialBatch}
                  onUpdateProject={handleSaveProject}
                  onGoToExport={() => setActiveSection('export-center')}
                />
              )}

              {activeSection === 'data-manager' && activeProject && (
                <DataManagerView
                  project={activeProject}
                  onUpdateProject={handleSaveProject}
                />
              )}

              {activeSection === 'preflight' && activeProject && (
                <PreflightView
                  project={activeProject}
                  customFonts={customFonts}
                  onUpdateProject={handleSaveProject}
                  onInspectElement={handleInspectElement}
                  onGoToExport={() => setActiveSection('export-center')}
                  onGoToDataManager={() => setActiveSection('data-manager')}
                />
              )}

              {activeSection === 'compare' && activeProject && (
                <ComparisonView
                  project={activeProject}
                  customFonts={customFonts}
                  onInspectElement={handleInspectElement}
                />
              )}

              {activeSection === 'batch-center' && (
                <BatchCenterView
                  projects={projects}
                  customFonts={customFonts}
                  batchJobs={batchJobs}
                  serialBatches={serialBatches}
                  checkpoints={batchCheckpoints}
                  onSaveBatchJob={handleSaveBatchJob}
                  onDeleteBatchJob={handleDeleteBatchJob}
                  onClearBatchHistory={handleClearBatchHistory}
                  onSaveCheckpoint={handleSaveCheckpoint}
                  onDeleteCheckpoint={handleDeleteCheckpoint}
                />
              )}

              {activeSection === 'workflow-studio' && (
                <WorkflowStudioView
                  projects={projects}
                  activeProject={activeProject}
                  customFonts={customFonts}
                  profiles={automationProfiles}
                  serialBatches={serialBatches}
                  workflows={workflows}
                  onSaveWorkflow={handleSaveWorkflow}
                  onDeleteWorkflow={handleDeleteWorkflow}
                  onUpdateProject={handleSaveProject}
                  onSavePassport={handleSavePassport}
                />
              )}

              {activeSection === 'asset-library' && (
                <AssetLibraryView
                  assets={assets}
                  activeProject={activeProject}
                  onSaveAsset={handleSaveAsset}
                  onDeleteAsset={handleDeleteAsset}
                  onInsertImageIntoProject={handleInsertImageFromLibrary}
                  onInsertShapeIntoProject={handleInsertShapeFromLibrary}
                />
              )}

              {activeSection === 'export-center' && activeProject && (
                <ExportCenterView
                  project={activeProject}
                  customFonts={customFonts}
                  passports={passports}
                  exportProfiles={exportProfiles}
                  onSavePassport={handleSavePassport}
                  onDeletePassport={handleDeletePassport}
                  onSaveExportProfile={handleSaveExportProfile}
                  onDeleteExportProfile={handleDeleteExportProfile}
                  onUpdateProject={handleSaveProject}
                  onJumpToEditor={() => setActiveSection('editor')}
                  onInspectElement={handleInspectElement}
                  onReopenAsProject={(proj) => handleProjectCreated(proj, true)}
                  onEnqueueBatch={handleEnqueueBatch}
                  onRecordExportActivity={handleSaveBatchJob}
                />
              )}

              {activeSection === 'pdf-utilities' && (
                <PdfUtilitiesView activeProject={activeProject} />
              )}

              {activeSection === 'settings' && (
                <SettingsView
                  settings={settings}
                  onUpdateSettings={setSettings}
                  onClearWorkspace={handleClearWorkspace}
                  onNavigate={setActiveSection}
                />
              )}

              {activeSection === 'about' && (
                <AboutView onNavigate={setActiveSection} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <CommandPaletteModal
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          projects={projects}
          blueprints={blueprints}
          profiles={automationProfiles}
          workflows={workflows}
          activeProject={activeProject}
          resolvedTheme={resolvedTheme}
          onToggleTheme={() =>
            setSettings((s) => ({
              ...s,
              theme: resolvedTheme === 'dark' ? 'light' : 'dark',
            }))
          }
          onNavigate={setActiveSection}
          onOpenProject={handleOpenProject}
        />
      </div>
    </MotionConfig>
  );
}
