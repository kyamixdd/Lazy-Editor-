import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bold,
  BookOpen,
  BoxSelect,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clipboard,
  Copy,
  CopyPlus,
  Crop,
  Edit3,
  Eye,
  EyeOff,
  FileCog,
  FolderPlus,
  GitCompare,
  Grid,
  Group,
  Highlighter,
  History,
  Image as ImageIcon,
  Layers,
  Lock,
  Magnet,
  Maximize2,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  Minus,
  MousePointer2,
  Paintbrush,
  PanelRight,
  PenTool,
  Pencil,
  Plus,
  QrCode,
  Redo2,
  Replace,
  Ruler,
  Save,
  ScanBarcode,
  ScanLine,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Stamp,
  Strikethrough,
  Table2,
  Trash2,
  Type as TypeIcon,
  Underline,
  Undo2,
  Ungroup,
  Unlock,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  FAB_TAP,
  MOTION_DURATION,
  MOTION_SPRING,
  bannerVariants,
  drawerLeftVariants,
  drawerRightVariants,
  floatingToolbarVariants,
  modalBackdropVariants,
  popoverVariants,
  toastVariants,
} from '../config/motionSystem';
import {
  ActiveEditorTool,
  AiEditPlan,
  AssetFontItem,
  AssetImageItem,
  AssetLibraryItem,
  AssetPaletteItem,
  AssetShapeItem,
  AssetTextStyleItem,
  DocumentElement,
  EditorToolCategory,
  HistoryEntry,
  MeasurementUnit,
  NavSection,
  PageConfig,
  PageRestorationConfig,
  PDFProject,
  ProjectVersionSnapshot,
  RectPt,
  SourceFitConfig,
  StudioSettings,
  StylePainterState,
  UnsavedDraftRecord,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import { runOptionalAiEnhancedAnalysis } from '../utils/aiEnhancedAnalysis';
import {
  AlignMode,
  alignSelectedElements,
  distributeSelectedElements,
  equalSpacingSelectedElements,
  matchesShortcutCombo,
} from '../utils/alignmentEngine';
import { convertSelectionToTableElement } from '../utils/tableReconstructionEngine';
import {
  computeElementsUnionRect,
  computeSheetLayout,
  normalizeFitConfig,
} from '../utils/geometryEngine';
import {
  detectPageContentBoundsFromBase64,
  renderPageThumbnail,
  renderSinglePagePreview,
} from '../utils/pdfRenderer';
import {
  computeProjectDirtySignature,
  defaultCategoryForTool,
  resolveEditorEscapeStep,
  toggleEditorTool,
  toggleSyncedSnapAndGuides,
} from '../utils/editorInteractions';
import { appendOperationLog, DEFAULT_SHORTCUTS } from '../utils/projectStorage';
import { extractStylePainterPatch } from '../utils/typographyEngine';
import { BatchStyleModal } from './BatchStyleModal';
import { GlassBottomSheet, SheetSnapState } from './glass';
import { PageConfigurationModal } from './PageConfigurationModal';
import { PageEngineeringModal } from './PageEngineeringModal';
import { PdfCanvasStage } from './PdfCanvasStage';
import { PropertiesInspector } from './PropertiesInspector';
import { RedactionConfirmModal } from './RedactionConfirmModal';
import { RestorationStudioModal } from './RestorationStudioModal';
import { SignatureStampModal } from './SignatureStampModal';
import { SmartReplaceModal } from './SmartReplaceModal';
import { VersionHistoryModal } from './VersionHistoryModal';

interface EditorViewProps {
  project: PDFProject;
  settings: StudioSettings;
  assets?: AssetLibraryItem[];
  focusTarget?: { pageNumber: number; elementId?: string; nonce: number } | null;
  onUpdateProject: (updated: PDFProject) => void;
  onUpdateSettings?: (next: StudioSettings) => void;
  onSaveSnapshot: (
    project: PDFProject,
    note: string
  ) => void | Promise<{ ok: boolean; version?: number; error?: string }>;
  onRestoreVersion?: (snapshot: ProjectVersionSnapshot) => void;
  onSaveAsset?: (asset: AssetLibraryItem) => void;
  onTrackRecentTool?: (toolId: string) => void;
  onSaveUnsavedDraft?: (draft: UnsavedDraftRecord) => void;
  onNavigateSection?: (section: NavSection) => void;
  onOpenMobileNav?: () => void;
}

type EditorMode = 'preview' | 'edit' | 'layers' | 'properties' | 'pages';

export const EditorView: React.FC<EditorViewProps> = ({
  project,
  settings,
  assets = [],
  focusTarget,
  onUpdateProject,
  onUpdateSettings,
  onSaveSnapshot,
  onRestoreVersion,
  onSaveAsset,
  onTrackRecentTool,
  onSaveUnsavedDraft,
  onNavigateSection,
  onOpenMobileNav,
}) => {
  const viewport = useViewport();
  const prefersReduced = useReducedMotion();
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [bottomToolsOpen, setBottomToolsOpen] = useState(true);
  const [showRulers, setShowRulers] = useState(settings.showRulersByDefault);
  const [showGrid, setShowGrid] = useState(settings.showGridByDefault);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [showLayersPanel, setShowLayersPanel] = useState(
    () => viewport.isDesktop && settings.workspaceLayout !== 'wide-canvas'
  );
  const [showDesktopInspector, setShowDesktopInspector] = useState(true);
  const [layersWidthPx, setLayersWidthPx] = useState(
    settings.layersPanelWidthPx || 224
  );
  const [inspectorWidthPx, setInspectorWidthPx] = useState(
    settings.inspectorWidthPx || 320
  );
  const [mobileSheetSnap, setMobileSheetSnap] = useState<SheetSnapState>('medium');
  const [mobileAddSheetOpen, setMobileAddSheetOpen] = useState(false);
  const [showMobileThumbStrip, setShowMobileThumbStrip] = useState(false);
  const [showPagesDrawer, setShowPagesDrawer] = useState(false);
  const [showInspectorDrawer, setShowInspectorDrawer] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showAssetInsertMenu, setShowAssetInsertMenu] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(
    null
  );
  const [styleToast, setStyleToast] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [showPageSetupModal, setShowPageSetupModal] = useState(false);
  const [redetectingBounds, setRedetectingBounds] = useState(false);
  const [aiEnhancing, setAiEnhancing] = useState(false);
  const [aiEnhanceNotice, setAiEnhanceNotice] = useState<{
    kind: 'info' | 'warning';
    message: string;
  } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'element' | 'page' | 'ai'>('element');
  const [clipboard, setClipboard] = useState<DocumentElement[]>([]);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [activeCategory, setActiveCategory] = useState<EditorToolCategory>('select');
  const [activeTool, setActiveTool] = useState<ActiveEditorTool>('select');
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const [measureUnit, setMeasureUnit] = useState<MeasurementUnit>(
    project.pageConfig.unit === 'px' ? 'mm' : project.pageConfig.unit
  );
  const [stylePainter, setStylePainter] = useState<StylePainterState>({
    active: false,
    mode: 'appearance',
  });
  const [copiedFormatting, setCopiedFormatting] =
    useState<Partial<DocumentElement> | null>(null);
  const [smartReplaceOpen, setSmartReplaceOpen] = useState(false);
  const [batchStyleOpen, setBatchStyleOpen] = useState(false);
  const [restorationOpen, setRestorationOpen] = useState(false);
  const [pageEngineeringOpen, setPageEngineeringOpen] = useState(false);
  const [signatureStampOpen, setSignatureStampOpen] = useState(false);
  const [signatureModalInitialTab, setSignatureModalInitialTab] = useState<
    'signature' | 'stamp'
  >('signature');
  const [redactionConfirmOpen, setRedactionConfirmOpen] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const thumbnailsRef = useRef<Record<number, string>>({});
  thumbnailsRef.current = thumbnails;
  const [pageBgUrl, setPageBgUrl] = useState<string | undefined>(
    project.originalPages[0]?.previewImageDataUrl
  );
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const assetMenuRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const saveStatusTimerRef = useRef<number | null>(null);
  const draftAutosaveTimerRef = useRef<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const handleSaveNowRef = useRef<((customNote?: string) => Promise<void>) | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const lastAutoSnapHashRef = useRef<string>(JSON.stringify(project.elements));
  const lastSavedDirtySigRef = useRef<string>(computeProjectDirtySignature(project));

  const customFonts = assets.filter((a): a is AssetFontItem => a.kind === 'font');
  const savedImages = assets.filter(
    (a): a is AssetImageItem => a.kind === 'image' || a.kind === 'logo'
  );
  const savedShapes = assets.filter((a): a is AssetShapeItem => a.kind === 'shape');
  const savedTextStyles = assets.filter(
    (a): a is AssetTextStyleItem => a.kind === 'text_style'
  );
  const savedPalettes = assets.filter(
    (a): a is AssetPaletteItem => a.kind === 'palette'
  );

  // Clamp currentPage and reset dirty baseline when switching projects
  useEffect(() => {
    setCurrentPage((p) => Math.max(1, Math.min(p, Math.max(1, project.pageCount))));
    lastAutoSnapHashRef.current = JSON.stringify(projectRef.current.elements);
    lastSavedDirtySigRef.current = computeProjectDirtySignature(projectRef.current);
    setSaveStatus('idle');
  }, [project.id]);

  useEffect(() => {
    setCurrentPage((p) => Math.max(1, Math.min(p, Math.max(1, project.pageCount))));
  }, [project.pageCount]);

  // Direct navigation from Preflight / Comparison / Export Center
  useEffect(() => {
    if (!focusTarget) return;
    const clampedPage = Math.max(
      1,
      Math.min(focusTarget.pageNumber, Math.max(1, project.pageCount))
    );
    setCurrentPage(clampedPage);
    if (focusTarget.elementId) {
      setSelectedIds([focusTarget.elementId]);
      setHighlightedElementId(focusTarget.elementId);
      setInspectorTab('element');
      const timer = window.setTimeout(() => {
        setHighlightedElementId(null);
      }, 3600);
      return () => window.clearTimeout(timer);
    }
  }, [focusTarget?.nonce]);

  // Autosave recoverable unsaved draft snapshot (debounced, only when dirty vs last saved state)
  useEffect(() => {
    if (!onSaveUnsavedDraft) return;
    if (draftAutosaveTimerRef.current !== null) {
      window.clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
    }
    const sig = computeProjectDirtySignature(project);
    if (sig === lastSavedDirtySigRef.current) return;

    draftAutosaveTimerRef.current = window.setTimeout(() => {
      draftAutosaveTimerRef.current = null;
      const latest = projectRef.current;
      if (computeProjectDirtySignature(latest) === lastSavedDirtySigRef.current) return;
      onSaveUnsavedDraft({
        projectId: latest.id,
        projectName: latest.name,
        savedAt: new Date().toISOString(),
        projectSnapshot: latest,
        dirty: true,
      });
    }, 900);
    return () => {
      if (draftAutosaveTimerRef.current !== null) {
        window.clearTimeout(draftAutosaveTimerRef.current);
        draftAutosaveTimerRef.current = null;
      }
    };
  }, [project.elements, project.pageConfig, project.fitConfig, project.copiesConfig, project.id]);

  // Automatic periodic version snapshots (Module 4)
  useEffect(() => {
    const intervalSec = settings.autoSnapshotIntervalSec ?? 120;
    if (intervalSec < 15) return;
    const id = window.setInterval(() => {
      const curr = projectRef.current;
      const hash = JSON.stringify(curr.elements);
      if (hash === lastAutoSnapHashRef.current) return;
      lastAutoSnapHashRef.current = hash;
      const now = new Date().toISOString();
      const autoSnap: ProjectVersionSnapshot = {
        version: curr.version,
        savedAt: now,
        note: `Auto-snapshot (${curr.elements.length} elements)`,
        isAutoSnapshot: true,
        elementsSnapshot: structuredClone(curr.elements),
        pageConfigSnapshot: structuredClone(curr.pageConfig),
        fitConfigSnapshot: curr.fitConfig ? structuredClone(curr.fitConfig) : undefined,
        copiesConfigSnapshot: structuredClone(curr.copiesConfig),
      };
      onUpdateProject({
        ...curr,
        versions: [autoSnap, ...(curr.versions || [])].slice(0, 40),
      });
    }, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [settings.autoSnapshotIntervalSec, project.id]);

  // Lazy-render page thumbnails when Pages drawer or mobile thumbnail strip opens
  useEffect(() => {
    const pagesOpen =
      showPagesDrawer ||
      showMobileThumbStrip ||
      (viewport.isMobile && editorMode === 'pages');
    if (!pagesOpen || !project.sourcePdfBase64) return;
    let cancelled = false;
    const loadThumbs = async () => {
      for (let p = 1; p <= project.pageCount; p++) {
        if (cancelled) return;
        const meta = project.originalPages.find((m) => m.pageNumber === p);
        if (meta?.previewImageDataUrl) {
          setThumbnails((prev) =>
            prev[p] ? prev : { ...prev, [p]: meta.previewImageDataUrl! }
          );
          continue;
        }
        if (thumbnailsRef.current[p]) continue;
        const srcPage = meta?.sourcePdfPageNumber || p;
        const url = await renderPageThumbnail(project.sourcePdfBase64!, srcPage);
        if (!cancelled && url) {
          setThumbnails((prev) => ({ ...prev, [p]: url }));
        }
      }
    };
    void loadThumbs();
    return () => {
      cancelled = true;
    };
  }, [
    showPagesDrawer,
    showMobileThumbStrip,
    editorMode,
    viewport.isMobile,
    project.id,
    project.pageCount,
    project.originalPages,
    project.sourcePdfBase64,
  ]);

  // Sync page preview image when page changes (respecting duplicated sourcePdfPageNumber)
  useEffect(() => {
    const meta = project.originalPages.find((p) => p.pageNumber === currentPage);
    if (meta?.previewImageDataUrl) {
      setPageBgUrl(meta.previewImageDataUrl);
      return;
    }
    if (project.sourcePdfBase64) {
      const targetPdfPage = meta?.sourcePdfPageNumber || currentPage;
      void renderSinglePagePreview(
        project.sourcePdfBase64,
        targetPdfPage,
        1.7
      ).then((url) => {
        if (url) setPageBgUrl(url);
      });
    } else {
      setPageBgUrl(undefined);
    }
  }, [currentPage, project.id, project.originalPages, project.sourcePdfBase64]);

  const makeHistorySnapshot = (
    label: string,
    actionType: string,
    targetProj: PDFProject = project,
    coalesceKey?: string
  ): HistoryEntry => ({
    id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    actionType,
    timestamp: new Date().toISOString(),
    elements: structuredClone(targetProj.elements),
    originalPages: structuredClone(targetProj.originalPages),
    pageConfig: structuredClone(targetProj.pageConfig),
    pageCount: targetProj.pageCount,
    coalesceKey,
  });

  const pushHistoryEntry = (
    label: string,
    actionType: string,
    coalesceKey?: string,
    baseProject: PDFProject = projectRef.current
  ) => {
    const snap = makeHistorySnapshot(label, actionType, baseProject, coalesceKey);
    setUndoStack((prev) => {
      if (coalesceKey && prev.length > 0) {
        const last = prev[prev.length - 1];
        const ageMs = Date.now() - Date.parse(last.timestamp);
        if (last.coalesceKey === coalesceKey && ageMs < 1200) {
          return [...prev.slice(0, -1), { ...last, timestamp: snap.timestamp, label }];
        }
      }
      return [...prev.slice(-45), snap];
    });
    setRedoStack([]);
  };

  const commitProjectChange = (
    nextProject: PDFProject,
    label: string,
    actionType = 'edit',
    opLogAction?: string,
    opLogDetail?: string,
    coalesceKey?: string
  ) => {
    pushHistoryEntry(label, actionType, coalesceKey, projectRef.current);
    const stamped = {
      ...nextProject,
      updatedAt: new Date().toISOString(),
    };
    const finalProj = opLogAction
      ? appendOperationLog(stamped, opLogAction, opLogDetail || label, currentPage)
      : stamped;
    projectRef.current = finalProj;
    onUpdateProject(finalProj);
  };

  const commitElements = (
    nextElements: DocumentElement[],
    recordHistory = true,
    opAction?: string,
    opDetail?: string,
    coalesceKey?: string
  ) => {
    const baseProj = projectRef.current;
    if (recordHistory) {
      pushHistoryEntry(opAction || 'Edit Element', 'elements', coalesceKey, baseProj);
    }
    const baseUpdated: PDFProject = {
      ...baseProj,
      elements: nextElements,
      updatedAt: new Date().toISOString(),
    };
    const finalProj = opAction
      ? appendOperationLog(
          baseUpdated,
          opAction,
          opDetail || opAction,
          currentPage
        )
      : baseUpdated;
    projectRef.current = finalProj;
    onUpdateProject(finalProj);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const currProj = projectRef.current;
    const prev = undoStack[undoStack.length - 1];
    const currSnap = makeHistorySnapshot(prev.label, 'redo_anchor', currProj);
    setRedoStack((r) => [...r, currSnap]);
    setUndoStack((u) => u.slice(0, -1));
    const restored: PDFProject = {
      ...currProj,
      elements: structuredClone(prev.elements),
      originalPages: structuredClone(prev.originalPages),
      pageConfig: structuredClone(prev.pageConfig),
      pageCount: prev.pageCount,
      updatedAt: new Date().toISOString(),
    };
    projectRef.current = restored;
    onUpdateProject(restored);
    setCurrentPage((cp) => Math.max(1, Math.min(cp, Math.max(1, prev.pageCount))));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const currProj = projectRef.current;
    const next = redoStack[redoStack.length - 1];
    const currSnap = makeHistorySnapshot(next.label, 'undo_anchor', currProj);
    setUndoStack((u) => [...u, currSnap]);
    setRedoStack((r) => r.slice(0, -1));
    const restored: PDFProject = {
      ...currProj,
      elements: structuredClone(next.elements),
      originalPages: structuredClone(next.originalPages),
      pageConfig: structuredClone(next.pageConfig),
      pageCount: next.pageCount,
      updatedAt: new Date().toISOString(),
    };
    projectRef.current = restored;
    onUpdateProject(restored);
    setCurrentPage((cp) => Math.max(1, Math.min(cp, Math.max(1, next.pageCount))));
  };

  const handleRevertToHistoryEntry = (entryId: string) => {
    const idx = undoStack.findIndex((e) => e.id === entryId);
    if (idx === -1) return;
    const currProj = projectRef.current;
    const target = undoStack[idx];
    const currSnap = makeHistorySnapshot('Before timeline rollback', 'rollback', currProj);
    setRedoStack((r) => [...r, currSnap]);
    setUndoStack((u) => u.slice(0, idx));
    const nextProj = appendOperationLog(
      {
        ...currProj,
        elements: structuredClone(target.elements),
        originalPages: structuredClone(target.originalPages),
        pageConfig: structuredClone(target.pageConfig),
        pageCount: target.pageCount,
        updatedAt: new Date().toISOString(),
      },
      'Rollback History',
      `Rolled back to "${target.label}"`,
      currentPage
    );
    projectRef.current = nextProj;
    onUpdateProject(nextProj);
    setCurrentPage((cp) => Math.max(1, Math.min(cp, Math.max(1, target.pageCount))));
  };

  const handleRevertIndividualOperation = (
    entryId: string
  ): { ok: boolean; message: string } => {
    const idx = undoStack.findIndex((e) => e.id === entryId);
    if (idx === -1) {
      return { ok: false, message: 'History entry not found.' };
    }
    const beforeEntry = undoStack[idx];
    const afterElements =
      idx + 1 < undoStack.length ? undoStack[idx + 1].elements : project.elements;

    if (
      beforeEntry.pageCount !==
      (idx + 1 < undoStack.length ? undoStack[idx + 1].pageCount : project.pageCount)
    ) {
      return {
        ok: false,
        message:
          'Page-structure mutations affect subsequent page indices — use "Roll Back to Here" instead.',
      };
    }

    const beforeMap = new Map(beforeEntry.elements.map((e) => [e.id, e]));
    const afterMap = new Map(afterElements.map((e) => [e.id, e]));
    const touchedIds = new Set<string>();
    for (const [id, el] of beforeMap.entries()) {
      const a = afterMap.get(id);
      if (!a || JSON.stringify(el) !== JSON.stringify(a)) touchedIds.add(id);
    }
    for (const id of afterMap.keys()) {
      if (!beforeMap.has(id)) touchedIds.add(id);
    }

    // Check if any later operations modified those same elements
    for (let j = idx + 1; j < undoStack.length; j++) {
      const laterBefore = new Map(undoStack[j].elements.map((e) => [e.id, e]));
      const laterAfter = new Map(
        (j + 1 < undoStack.length ? undoStack[j + 1].elements : project.elements).map(
          (e) => [e.id, e]
        )
      );
      for (const tid of touchedIds) {
        const lb = laterBefore.get(tid);
        const la = laterAfter.get(tid);
        if (JSON.stringify(lb) !== JSON.stringify(la)) {
          return {
            ok: false,
            message:
              'Later edits depend on the same element(s) — use "Roll Back to Here" to avoid conflicts.',
          };
        }
      }
    }

    let nextEls = [...project.elements];
    for (const tid of touchedIds) {
      const orig = beforeMap.get(tid);
      if (!orig) {
        nextEls = nextEls.filter((e) => e.id !== tid);
      } else if (nextEls.some((e) => e.id === tid)) {
        nextEls = nextEls.map((e) => (e.id === tid ? structuredClone(orig) : e));
      } else {
        nextEls.push(structuredClone(orig));
      }
    }

    commitElements(
      nextEls,
      true,
      'Revert Single Edit',
      `Reverted "${beforeEntry.label}"`
    );
    return {
      ok: true,
      message: `Reverted "${beforeEntry.label}" (${touchedIds.size} element(s) restored).`,
    };
  };

  const handleUpdateElement = (id: string, patch: Partial<DocumentElement>) => {
    const isTextOnly =
      Object.keys(patch).length === 1 && patch.text !== undefined;
    commitElements(
      projectRef.current.elements.map((el) =>
        el.id === id ? { ...el, ...patch } : el
      ),
      true,
      undefined,
      undefined,
      isTextOnly ? `text-${id}` : undefined
    );
  };

  const handleUpdateElementsBatch = (
    updates: Array<{ id: string; patch: Partial<DocumentElement> }>
  ) => {
    const map = new Map(updates.map((u) => [u.id, u.patch]));
    commitElements(
      projectRef.current.elements.map((el) =>
        map.has(el.id) ? { ...el, ...map.get(el.id)! } : el
      )
    );
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const toDelete = new Set(selectedIds);
    // Keep a hidden eraser rect if deleting original PDF text so it clears on export
    const next: DocumentElement[] = [];
    for (const el of project.elements) {
      if (toDelete.has(el.id)) {
        if (!el.isUserAdded && el.sourceOriginalRect) {
          next.push({
            ...el,
            text: '',
            visible: false,
            eraseOriginal: true,
          });
        }
      } else {
        next.push(el);
      }
    }
    commitElements(next);
    setSelectedIds([]);
  };

  const handleDeleteElementById = (id: string) => {
    const next: DocumentElement[] = [];
    for (const el of project.elements) {
      if (el.id === id) {
        if (!el.isUserAdded && el.sourceOriginalRect) {
          next.push({
            ...el,
            text: '',
            visible: false,
            eraseOriginal: true,
          });
        }
      } else {
        next.push(el);
      }
    }
    commitElements(next);
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const handleDuplicateSelected = () => {
    if (selectedIds.length === 0) return;
    const dx = settings.duplicateOffsetXPt ?? 14;
    const dy = settings.duplicateOffsetYPt ?? 14;
    const clones: DocumentElement[] = project.elements
      .filter((e) => selectedIds.includes(e.id))
      .map((e) => ({
        ...structuredClone(e),
        id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x: e.x + dx,
        y: e.y + dy,
        isUserAdded: true,
        eraseOriginal: false,
        sourceOriginalRect: undefined,
      }));
    commitElements(
      [...project.elements, ...clones],
      true,
      'Duplicate Elements',
      `Duplicated ${clones.length} element(s) with offset (+${dx}, +${dy}pt)`
    );
    setSelectedIds(clones.map((c) => c.id));
    onTrackRecentTool?.('duplicate');
  };

  const handleDuplicateElementById = (id: string) => {
    const src = project.elements.find((e) => e.id === id);
    if (!src) return;
    const dx = settings.duplicateOffsetXPt ?? 14;
    const dy = settings.duplicateOffsetYPt ?? 14;
    const clone: DocumentElement = {
      ...structuredClone(src),
      id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: src.x + dx,
      y: src.y + dy,
      isUserAdded: true,
      eraseOriginal: false,
      sourceOriginalRect: undefined,
    };
    commitElements(
      [...project.elements, clone],
      true,
      'Duplicate Element',
      `Duplicated "${src.text.slice(0, 20) || src.type}"`
    );
    setSelectedIds([clone.id]);
    onTrackRecentTool?.('duplicate');
  };

  const handleAlignSelected = (mode: AlignMode) => {
    const updates = alignSelectedElements(
      project.elements.filter((e) => e.pageNumber === currentPage),
      selectedIds,
      mode
    );
    if (updates.length > 0) {
      handleUpdateElementsBatch(updates);
      onTrackRecentTool?.(`align_${mode}`);
    }
  };

  const handleDistributeSelected = (axis: 'horizontal' | 'vertical') => {
    const updates = distributeSelectedElements(
      project.elements.filter((e) => e.pageNumber === currentPage),
      selectedIds,
      axis
    );
    if (updates.length > 0) {
      handleUpdateElementsBatch(updates);
      onTrackRecentTool?.(`distribute_${axis}`);
    }
  };

  const handleEqualSpaceSelected = (
    axis: 'horizontal' | 'vertical',
    gapPt?: number
  ) => {
    const updates = equalSpacingSelectedElements(
      project.elements.filter((e) => e.pageNumber === currentPage),
      selectedIds,
      axis,
      gapPt
    );
    if (updates.length > 0) {
      handleUpdateElementsBatch(updates);
      onTrackRecentTool?.(`space_${axis}`);
    }
  };

  const handleBatchUpdateSelected = (patch: Partial<DocumentElement>) => {
    if (selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    commitElements(
      project.elements.map((el) => {
        if (!set.has(el.id)) return el;
        if (el.locked && patch.locked === undefined) return el;
        return {
          ...el,
          ...patch,
          ...(patch.x !== undefined || patch.y !== undefined
            ? { eraseOriginal: el.isUserAdded ? false : true }
            : {}),
        };
      }),
      true,
      'Batch Update',
      `Updated ${selectedIds.length} selected element(s)`
    );
  };

  const handleSaveAsTextStyle = (el: DocumentElement) => {
    if (!onSaveAsset) return;
    const item: AssetTextStyleItem = {
      id: `style-${Date.now()}`,
      kind: 'text_style',
      name: `${el.fontFamily} ${el.fontSize}pt ${el.fontWeight === 'bold' ? 'Bold' : ''}`.trim(),
      fontFamily: el.fontFamily,
      fontSize: el.fontSize,
      fontWeight: el.fontWeight,
      fontStyle: el.fontStyle,
      color: el.color,
      backgroundColor: el.backgroundColor,
      align: el.align,
      createdAt: new Date().toISOString(),
    };
    onSaveAsset(item);
    showNoticeToast(`Saved text style "${item.name}" to Asset Library`);
  };

  const handleInsertAssetImage = (imgAsset: AssetImageItem) => {
    const ratio = imgAsset.naturalHeight / Math.max(1, imgAsset.naturalWidth);
    const wPt = Math.min(180, Math.max(60, imgAsset.naturalWidth * 0.4));
    const hPt = Math.max(24, wPt * ratio);
    const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const el: DocumentElement = {
      id,
      type: 'image',
      pageNumber: currentPage,
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
    commitElements(
      [...project.elements, el],
      true,
      'Insert Asset Image',
      `Inserted "${imgAsset.name}" from Asset Library`
    );
    setSelectedIds([id]);
    setShowAssetInsertMenu(false);
    onTrackRecentTool?.('image');
  };

  const handleInsertAssetShape = (shapeAsset: AssetShapeItem) => {
    const id = `shp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const el: DocumentElement = {
      id,
      type: shapeAsset.shapeKind === 'line' ? 'line' : 'shape',
      shapeKind: shapeAsset.shapeKind,
      pageNumber: currentPage,
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
    commitElements(
      [...project.elements, el],
      true,
      'Insert Asset Shape',
      `Inserted "${shapeAsset.name}" from Asset Library`
    );
    setSelectedIds([id]);
    setShowAssetInsertMenu(false);
    onTrackRecentTool?.(shapeAsset.shapeKind);
  };

  const handleReorderElement = (
    id: string,
    dir: 'front' | 'back' | 'forward' | 'backward'
  ) => {
    const pageEls = project.elements.filter((e) => e.pageNumber === currentPage);
    const otherEls = project.elements.filter((e) => e.pageNumber !== currentPage);
    const idx = pageEls.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const nextPageEls = [...pageEls];
    const [target] = nextPageEls.splice(idx, 1);
    if (dir === 'front') {
      nextPageEls.push(target);
    } else if (dir === 'back') {
      nextPageEls.unshift(target);
    } else if (dir === 'forward') {
      nextPageEls.splice(Math.min(nextPageEls.length, idx + 1), 0, target);
    } else {
      nextPageEls.splice(Math.max(0, idx - 1), 0, target);
    }
    commitElements([...otherEls, ...nextPageEls]);
  };

  const handleCopy = () => {
    const picked = project.elements.filter((e) => selectedIds.includes(e.id));
    if (picked.length > 0) setClipboard(structuredClone(picked));
  };

  const handlePaste = () => {
    if (clipboard.length === 0) return;
    const pasted: DocumentElement[] = clipboard.map((e) => ({
      ...structuredClone(e),
      id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pageNumber: currentPage,
      x: e.x + (settings.duplicateOffsetXPt ?? 18),
      y: e.y + (settings.duplicateOffsetYPt ?? 18),
      isUserAdded: true,
      eraseOriginal: false,
      sourceOriginalRect: undefined,
    }));
    commitElements([...project.elements, ...pasted], true, 'Paste Elements', `Pasted ${pasted.length} element(s)`);
    setSelectedIds(pasted.map((p) => p.id));
  };

  const handleGroupToggle = () => {
    if (selectedIds.length < 2) {
      // Ungroup if single grouped element selected
      const first = project.elements.find((e) => selectedIds.includes(e.id));
      if (first?.groupId) {
        const gid = first.groupId;
        commitElements(
          project.elements.map((e) =>
            e.groupId === gid ? { ...e, groupId: undefined } : e
          ),
          true,
          'Ungroup Elements',
          `Ungrouped elements in ${gid}`
        );
      }
      return;
    }
    const newGroupId = `grp-${Date.now()}`;
    const set = new Set(selectedIds);
    commitElements(
      project.elements.map((e) =>
        set.has(e.id) ? { ...e, groupId: newGroupId } : e
      ),
      true,
      'Group Elements',
      `Grouped ${selectedIds.length} elements`
    );
    onTrackRecentTool?.('group');
  };

  const handleConvertSelectionToTable = () => {
    const selectedOnPage = pageElements.filter((e) => selectedIds.includes(e.id));
    if (selectedOnPage.length < 2) return;
    const tableEl = convertSelectionToTableElement(selectedOnPage, currentPage);
    if (!tableEl) return;
    const selSet = new Set(selectedOnPage.map((e) => e.id));
    const nextElements = project.elements
      .filter((e) => !selSet.has(e.id))
      .concat(tableEl);
    commitElements(
      nextElements,
      true,
      'Convert Selection to Table',
      `Converted ${selectedOnPage.length} elements into a ${tableEl.tableData?.rows.length || 1}×${tableEl.tableData?.rows[0]?.length || 1} table`
    );
    setSelectedIds([tableEl.id]);
    onTrackRecentTool?.('table');
  };

  const addNewElement = (
    kind:
      | 'text'
      | 'rect'
      | 'circle'
      | 'line'
      | 'border'
      | 'table'
      | 'qr_code'
      | 'barcode'
  ) => {
    const id = `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const base: DocumentElement = {
      id,
      type:
        kind === 'text'
          ? 'text'
          : kind === 'line'
          ? 'line'
          : kind === 'border'
          ? 'border'
          : kind === 'table'
          ? 'table'
          : kind === 'qr_code'
          ? 'qr_code'
          : kind === 'barcode'
          ? 'barcode'
          : 'shape',
      pageNumber: currentPage,
      x: 72,
      y: 90,
      width:
        kind === 'table'
          ? 320
          : kind === 'line'
          ? 220
          : kind === 'barcode'
          ? 160
          : kind === 'qr_code'
          ? 84
          : 150,
      height:
        kind === 'table'
          ? 96
          : kind === 'line'
          ? 12
          : kind === 'text'
          ? 28
          : kind === 'barcode'
          ? 54
          : kind === 'qr_code'
          ? 84
          : 80,
      rotation: 0,
      text:
        kind === 'text'
          ? 'New Text Block'
          : kind === 'qr_code'
          ? 'https://pdfstudio.local/verify'
          : kind === 'barcode'
          ? 'INV-0001'
          : '',
      fontFamily: 'Helvetica',
      fontSize: 12,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#111827',
      backgroundColor:
        kind === 'qr_code' || kind === 'barcode' ? '#FFFFFF' : 'transparent',
      borderColor: '#1E293B',
      borderWidth: 1.2,
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: 1,
      needsReview: false,
      isUserAdded: true,
      barcodeFormat:
        kind === 'qr_code' ? 'qr' : kind === 'barcode' ? 'code128' : undefined,
      barcodeValue:
        kind === 'qr_code'
          ? 'https://pdfstudio.local/verify'
          : kind === 'barcode'
          ? 'INV-0001'
          : undefined,
      barcodeIncludeText: kind === 'barcode' ? true : undefined,
      qrErrorCorrection: kind === 'qr_code' ? 'M' : undefined,
      barcodeQuietZonePt:
        kind === 'qr_code' || kind === 'barcode' ? 6 : undefined,
      shapeKind:
        kind === 'circle' ? 'circle' : kind === 'rect' || kind === 'border' ? 'rect' : undefined,
      tableData:
        kind === 'table'
          ? {
              rows: [
                ['Description', 'Qty', 'Unit Price', 'Total'],
                ['Service Item', '1', '$100.00', '$100.00'],
                ['Tax', '1', '$10.00', '$10.00'],
              ],
              headerRow: true,
              borderColor: '#94A3B8',
              headerBgColor: '#F1F5F9',
              cellPadding: 4,
            }
          : undefined,
    };
    commitElements(
      [...project.elements, base],
      true,
      'Add Element',
      `Added ${kind} element on Page ${currentPage}`
    );
    setSelectedIds([id]);
    setInspectorTab('element');
    onTrackRecentTool?.(kind);
  };

  const handleDuplicatePage = () => {
    const newPageNum = currentPage + 1;
    const currentMeta = project.originalPages.find(
      (p) => p.pageNumber === currentPage
    ) || {
      pageNumber: currentPage,
      sourcePdfPageNumber: currentPage,
      widthPt: project.pageConfig.widthPt,
      heightPt: project.pageConfig.heightPt,
      orientation: (project.pageConfig.widthPt > project.pageConfig.heightPt
        ? 'landscape'
        : 'portrait') as 'portrait' | 'landscape',
      previewImageDataUrl: pageBgUrl,
    };

    const nextOriginalPages = [
      ...project.originalPages.filter((p) => p.pageNumber <= currentPage),
      {
        ...structuredClone(currentMeta),
        pageNumber: newPageNum,
        sourcePdfPageNumber: currentMeta.sourcePdfPageNumber || currentPage,
      },
      ...project.originalPages
        .filter((p) => p.pageNumber > currentPage)
        .map((p) => ({ ...p, pageNumber: p.pageNumber + 1 })),
    ];

    const clonedPageElements: DocumentElement[] = project.elements
      .filter((e) => e.pageNumber === currentPage)
      .map((e) => ({
        ...structuredClone(e),
        id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageNumber: newPageNum,
      }));

    const shiftedElements = project.elements.map((e) =>
      e.pageNumber > currentPage ? { ...e, pageNumber: e.pageNumber + 1 } : e
    );

    commitProjectChange(
      {
        ...project,
        pageCount: project.pageCount + 1,
        originalPages: nextOriginalPages,
        elements: [...shiftedElements, ...clonedPageElements],
      },
      `Duplicate Page ${currentPage}`,
      'page_structure',
      'Duplicate Page',
      `Duplicated Page ${currentPage} to Page ${newPageNum}`
    );
    setCurrentPage(newPageNum);
    setSelectedIds([]);
  };

  const handleCreateDocumentBlock = () => {
    const existingBlockIds = new Set(
      project.elements.map((e) => e.blockId).filter(Boolean)
    );
    let idx = 0;
    while (existingBlockIds.has(`block-${String.fromCharCode(65 + idx)}`)) {
      idx++;
    }
    const newBlockId = `block-${String.fromCharCode(65 + idx)}`;
    const selectedOnPage = project.elements.filter(
      (e) => e.pageNumber === currentPage && selectedIds.includes(e.id)
    );

    if (selectedOnPage.length > 0) {
      const minX = Math.max(0, Math.min(...selectedOnPage.map((e) => e.x)) - 8);
      const minY = Math.max(0, Math.min(...selectedOnPage.map((e) => e.y)) - 8);
      const maxX = Math.max(...selectedOnPage.map((e) => e.x + e.width)) + 8;
      const maxY = Math.max(...selectedOnPage.map((e) => e.y + e.height)) + 8;

      const frameId = `blk-${Date.now()}`;
      const frame: DocumentElement = {
        id: frameId,
        type: 'repeated_block',
        pageNumber: currentPage,
        x: minX,
        y: minY,
        width: Math.max(40, maxX - minX),
        height: Math.max(40, maxY - minY),
        rotation: 0,
        text: newBlockId,
        fontFamily: 'Helvetica',
        fontSize: 10,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#404040',
        backgroundColor: 'transparent',
        borderColor: '#404040',
        borderWidth: 1,
        align: 'left',
        opacity: 1,
        editable: true,
        locked: false,
        visible: true,
        blockId: newBlockId,
        confidence: 1,
        needsReview: false,
        isUserAdded: true,
      };

      const selSet = new Set(selectedIds);
      const updated = project.elements.map((el) =>
        selSet.has(el.id) ? { ...el, blockId: newBlockId } : el
      );
      commitElements([...updated, frame]);
      setSelectedIds([frameId]);
    } else {
      const frameId = `blk-${Date.now()}`;
      const frame: DocumentElement = {
        id: frameId,
        type: 'repeated_block',
        pageNumber: currentPage,
        x: 36,
        y: 36 + idx * 40,
        width: Math.max(120, project.pageConfig.widthPt - 72),
        height: 180,
        rotation: 0,
        text: newBlockId,
        fontFamily: 'Helvetica',
        fontSize: 10,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#404040',
        backgroundColor: 'transparent',
        borderColor: '#404040',
        borderWidth: 1,
        align: 'left',
        opacity: 1,
        editable: true,
        locked: false,
        visible: true,
        blockId: newBlockId,
        confidence: 1,
        needsReview: false,
        isUserAdded: true,
      };
      commitElements([...project.elements, frame]);
      setSelectedIds([frameId]);
    }
    setInspectorTab('element');
  };

  const handleImageUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        // Normalize to clean PNG so pdf-lib always embeds cleanly regardless of source image format
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 200;
        canvas.height = img.naturalHeight || 150;
        const ctx = canvas.getContext('2d');
        let normalizedUrl = rawUrl;
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          normalizedUrl = canvas.toDataURL('image/png');
        }
        const naturalW = canvas.width;
        const naturalH = canvas.height;
        const ratio = naturalH / Math.max(1, naturalW);
        const wPt = Math.min(180, Math.max(60, naturalW * 0.5));
        const hPt = Math.max(24, wPt * ratio);
        canvas.width = 0;
        canvas.height = 0;

        const id = `img-${Date.now()}`;
        const el: DocumentElement = {
          id,
          type: 'image',
          pageNumber: currentPage,
          x: 60,
          y: 60,
          width: Number(wPt.toFixed(1)),
          height: Number(hPt.toFixed(1)),
          rotation: 0,
          text: file.name,
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
          imageDataUrl: normalizedUrl,
          imageNaturalWidth: naturalW,
          imageNaturalHeight: naturalH,
        };
        commitElements(
          [...projectRef.current.elements, el],
          true,
          'Insert Image',
          `Uploaded image "${file.name}" (${naturalW}×${naturalH}px)`
        );
        setSelectedIds([id]);
        onTrackRecentTool?.('image');
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
    if (imageUploadRef.current) {
      imageUploadRef.current.value = '';
    }
  };

  const handleSearchAndReplace = () => {
    if (!findQuery) return;
    let changed = 0;
    const next = project.elements.map((el) => {
      if (el.locked || !el.text.includes(findQuery)) return el;
      changed++;
      return {
        ...el,
        text: el.text.split(findQuery).join(replaceQuery),
        eraseOriginal: el.isUserAdded ? false : true,
      };
    });
    if (changed > 0) {
      commitElements(next);
    }
  };

  const handleApplyAiPlan = (plan: AiEditPlan) => {
    let next = [...project.elements];
    for (const op of plan.operations) {
      if (op.action === 'update' && op.targetId && op.patch) {
        next = next.map((el) =>
          el.id === op.targetId && !el.locked
            ? {
                ...el,
                ...op.patch,
                eraseOriginal: el.isUserAdded ? false : true,
              }
            : el
        );
      } else if (op.action === 'delete' && op.targetId) {
        const target = next.find((el) => el.id === op.targetId);
        if (target && !target.locked) {
          next = next.filter((el) => el.id !== op.targetId);
        }
      } else if (op.action === 'duplicate' && op.targetId) {
        const src = next.find((el) => el.id === op.targetId && !el.locked);
        if (src) {
          next.push({
            ...structuredClone(src),
            ...(op.patch || {}),
            id: `el-ai-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            isUserAdded: true,
            eraseOriginal: false,
            sourceOriginalRect: undefined,
          });
        }
      } else if (op.action === 'create' && op.newElement) {
        next.push({
          id: `el-ai-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          type: (op.newElement.type as DocumentElement['type']) || 'text',
          pageNumber: op.newElement.pageNumber || currentPage,
          x: op.newElement.x ?? 60,
          y: op.newElement.y ?? 60,
          width: op.newElement.width ?? 160,
          height: op.newElement.height ?? 24,
          rotation: 0,
          text: op.newElement.text || 'New Element',
          fontFamily: 'Helvetica',
          fontSize: op.newElement.fontSize ?? 12,
          fontWeight:
            op.newElement.fontWeight === 'bold' ? 'bold' : 'normal',
          fontStyle: 'normal',
          color: op.newElement.color || '#111827',
          backgroundColor: 'transparent',
          align:
            op.newElement.align === 'center' || op.newElement.align === 'right'
              ? op.newElement.align
              : 'left',
          opacity: 1,
          editable: true,
          locked: false,
          visible: true,
          confidence: 1,
          needsReview: false,
          isUserAdded: true,
        });
      }
    }
    commitElements(next);
  };

  const handleUpdatePageConfig = (patch: Partial<PageConfig>) => {
    const nextPageConfig = { ...project.pageConfig, ...patch };
    commitProjectChange(
      {
        ...project,
        pageConfig: nextPageConfig,
        exportConfig: {
          ...project.exportConfig,
          ...(patch.bleedPt !== undefined ? { bleedPt: patch.bleedPt } : {}),
          ...(patch.cropMarks !== undefined ? { cropMarks: patch.cropMarks } : {}),
          customWidthPt: undefined,
          customHeightPt: undefined,
        },
      },
      'Page Configuration',
      'page_config',
      'Update Page Config',
      'Updated paper size, orientation, or margins',
      'page-cfg-inspector'
    );
  };

  const fitConfig = normalizeFitConfig(project);
  const currentMeta =
    project.originalPages.find((p) => p.pageNumber === currentPage) ||
    project.originalPages[0];
  const currentLayout = computeSheetLayout(project, currentPage);

  const handleUpdateFitConfig = (patch: Partial<SourceFitConfig>) => {
    commitProjectChange(
      {
        ...project,
        fitConfig: { ...fitConfig, ...patch },
      },
      'Source Fit & Crop',
      'fit_config',
      'Update Source Fit',
      'Adjusted page fitting or crop boundaries',
      'fit-cfg-inspector'
    );
  };

  const handleChangeCropRect = (rect: RectPt) => {
    const isManual = fitConfig.boundaryMode === 'manual_selection';
    handleUpdateFitConfig({
      boundaryMode: isManual ? 'manual_selection' : 'custom_crop',
      ...(isManual ? { manualBoundsRect: rect } : { customCropRect: rect }),
    });
  };

  const handleRedetectBounds = async () => {
    setRedetectingBounds(true);
    try {
      const targetPdfPage = currentMeta?.sourcePdfPageNumber || currentPage;
      let detected = project.sourcePdfBase64
        ? await detectPageContentBoundsFromBase64(
            project.sourcePdfBase64,
            targetPdfPage
          )
        : null;

      if (!detected) {
        const origW = currentMeta?.widthPt || project.pageConfig.widthPt;
        const origH = currentMeta?.heightPt || project.pageConfig.heightPt;
        const union =
          computeElementsUnionRect(
            project.elements,
            currentPage,
            origW,
            origH,
            2
          ) || { x: 0, y: 0, width: origW, height: origH };
        detected = {
          contentBBox: union,
          whitespaceInsetsPt: {
            top: union.y,
            left: union.x,
            right: Math.max(0, origW - (union.x + union.width)),
            bottom: Math.max(0, origH - (union.y + union.height)),
          },
          blockBoxes: [],
        };
      }

      const nextOriginalPages = project.originalPages.map((p) =>
        p.pageNumber === currentPage
          ? {
              ...p,
              contentBBox: detected!.contentBBox,
              detectedBounds: detected!,
            }
          : p
      );

      onUpdateProject({
        ...project,
        originalPages: nextOriginalPages,
        fitConfig: {
          ...fitConfig,
          boundaryMode: 'auto_content',
        },
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setRedetectingBounds(false);
    }
  };

  const handleRunAiEnhancedAnalysis = async () => {
    setAiEnhancing(true);
    setAiEnhanceNotice(null);
    const result = await runOptionalAiEnhancedAnalysis(project);
    setAiEnhancing(false);

    if (!result.ok || !result.updatedProject) {
      setAiEnhanceNotice({
        kind: 'warning',
        message: result.message,
      });
      return;
    }

    commitElements(
      result.updatedProject.elements,
      true,
      'AI Enhanced Analysis',
      result.message
    );
    setAiEnhanceNotice({
      kind: 'info',
      message: result.message,
    });
  };

  const pageElements = project.elements.filter(
    (e) => e.pageNumber === currentPage
  );
  const selectedElements = pageElements.filter((e) =>
    selectedIds.includes(e.id)
  );
  const reviewQueueCount = pageElements.filter((e) => e.needsReview).length;

  // Global keyboard shortcuts (Module 1 & 9)
  useEffect(() => {
    const shortcuts = { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcutCombo(e, shortcuts.saveSnapshot)) {
        e.preventDefault();
        void handleSaveNowRef.current?.(`Snapshot via shortcut (Page ${currentPage})`);
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (matchesShortcutCombo(e, shortcuts.undo)) {
        e.preventDefault();
        handleUndo();
      } else if (matchesShortcutCombo(e, shortcuts.redo)) {
        e.preventDefault();
        handleRedo();
      } else if (matchesShortcutCombo(e, shortcuts.copy)) {
        e.preventDefault();
        handleCopy();
      } else if (matchesShortcutCombo(e, shortcuts.paste)) {
        e.preventDefault();
        handlePaste();
      } else if (matchesShortcutCombo(e, shortcuts.duplicate)) {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (matchesShortcutCombo(e, shortcuts.delete)) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (matchesShortcutCombo(e, shortcuts.group)) {
        e.preventDefault();
        handleGroupToggle();
      } else if (matchesShortcutCombo(e, shortcuts.lock)) {
        if (selectedElements.length > 0) {
          e.preventDefault();
          const anyUnlocked = selectedElements.some((el) => !el.locked);
          handleBatchUpdateSelected({ locked: anyUnlocked });
        }
      } else if (matchesShortcutCombo(e, shortcuts.selectAll)) {
        e.preventDefault();
        setSelectedIds(pageElements.filter((el) => el.visible).map((el) => el.id));
      } else if (matchesShortcutCombo(e, shortcuts.zoomIn)) {
        e.preventDefault();
        setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))));
      } else if (matchesShortcutCombo(e, shortcuts.zoomOut)) {
        e.preventDefault();
        setZoom((z) => Math.max(0.3, Number((z - 0.15).toFixed(2))));
      } else if (e.key === 'Escape') {
        const hasOpenModal =
          showPageSetupModal ||
          showVersionModal ||
          smartReplaceOpen ||
          batchStyleOpen ||
          restorationOpen ||
          pageEngineeringOpen ||
          signatureStampOpen ||
          redactionConfirmOpen;
        const step = resolveEditorEscapeStep({
          hasOpenModal,
          showAssetInsertMenu,
          showSearchBar,
          cropMode,
          stylePainterActive: stylePainter.active,
          activeTool,
          hasOpenMobileOrTabletOverlay:
            (!viewport.isDesktop &&
              (showLayersPanel ||
                showInspectorDrawer ||
                showPagesDrawer ||
                mobileAddSheetOpen ||
                showMobileThumbStrip)),
          selectedCount: selectedIds.length,
        });
        if (step === 'asset_menu') {
          setShowAssetInsertMenu(false);
        } else if (step === 'search_bar') {
          setShowSearchBar(false);
        } else if (step === 'crop_mode') {
          setCropMode(false);
        } else if (step === 'style_painter') {
          setStylePainter({ active: false, mode: stylePainter.mode });
          setActiveTool('select');
        } else if (step === 'active_tool') {
          setActiveTool('select');
          setActiveCategory('select');
        } else if (step === 'mobile_or_tablet_drawer') {
          setShowLayersPanel(false);
          setShowInspectorDrawer(false);
          setShowPagesDrawer(false);
          setMobileAddSheetOpen(false);
          setShowMobileThumbStrip(false);
          if (viewport.isMobile) setEditorMode('edit');
        } else if (step === 'selection') {
          setSelectedIds([]);
        }
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const lk = e.key.toLowerCase();
        if (lk === 'v') {
          setActiveCategory('select');
          setActiveTool('select');
        } else if (lk === 't') {
          setActiveCategory('text');
          setActiveTool('text');
          setToolbarExpanded(true);
        } else if (lk === 'i') {
          setActiveCategory('images');
          setToolbarExpanded(true);
        } else if (lk === 's') {
          setActiveCategory('shapes');
          setActiveTool('rect');
          setToolbarExpanded(true);
        } else if (lk === 'p') {
          setActiveCategory('draw');
          setActiveTool('draw');
          setToolbarExpanded(true);
        } else if (lk === 'a') {
          setActiveCategory('annotate');
          setActiveTool('highlight');
          setToolbarExpanded(true);
        } else if (lk === 'l') {
          setActiveCategory('arrange');
          setActiveTool('select');
          setToolbarExpanded(true);
        } else if (lk === 'g') {
          setActiveCategory('pages');
          setToolbarExpanded(true);
        } else if (lk === 'm') {
          setActiveCategory('measure');
          setActiveTool('measure');
          setToolbarExpanded(true);
        } else if (lk === 'k') {
          setActiveCategory('inspect');
          setToolbarExpanded(true);
        } else if (selectedIds.length > 0) {
          const step = e.shiftKey ? 10 : 1;
          const nudged = (dx: number, dy: number) => {
            e.preventDefault();
            const updates = pageElements
              .filter((el) => selectedIds.includes(el.id) && !el.locked)
              .map((el) => ({
                id: el.id,
                patch: {
                  x: Number((el.x + dx).toFixed(2)),
                  y: Number((el.y + dy).toFixed(2)),
                  eraseOriginal: el.isUserAdded ? false : true,
                },
              }));
            if (updates.length > 0) handleUpdateElementsBatch(updates);
          };
          if (e.key === 'ArrowUp' || matchesShortcutCombo(e, shortcuts.nudgeUp)) {
            nudged(0, -step);
          } else if (e.key === 'ArrowDown' || matchesShortcutCombo(e, shortcuts.nudgeDown)) {
            nudged(0, step);
          } else if (e.key === 'ArrowLeft' || matchesShortcutCombo(e, shortcuts.nudgeLeft)) {
            nudged(-step, 0);
          } else if (e.key === 'ArrowRight' || matchesShortcutCombo(e, shortcuts.nudgeRight)) {
            nudged(step, 0);
          }
        }
      } else if (selectedIds.length > 0) {
        const step = e.shiftKey ? 10 : 1;
        const nudged = (dx: number, dy: number) => {
          e.preventDefault();
          const updates = pageElements
            .filter((el) => selectedIds.includes(el.id) && !el.locked)
            .map((el) => ({
              id: el.id,
              patch: {
                x: Number((el.x + dx).toFixed(2)),
                y: Number((el.y + dy).toFixed(2)),
                eraseOriginal: el.isUserAdded ? false : true,
              },
            }));
          if (updates.length > 0) handleUpdateElementsBatch(updates);
        };
        if (e.key === 'ArrowUp' || matchesShortcutCombo(e, shortcuts.nudgeUp)) {
          nudged(0, -step);
        } else if (e.key === 'ArrowDown' || matchesShortcutCombo(e, shortcuts.nudgeDown)) {
          nudged(0, step);
        } else if (e.key === 'ArrowLeft' || matchesShortcutCombo(e, shortcuts.nudgeLeft)) {
          nudged(-step, 0);
        } else if (e.key === 'ArrowRight' || matchesShortcutCombo(e, shortcuts.nudgeRight)) {
          nudged(step, 0);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const isToolHidden = (id: string) =>
    Boolean(settings.hiddenEditorTools?.includes(id));

  const showNoticeToast = (msg: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setStyleToast(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setStyleToast(null);
      toastTimerRef.current = null;
    }, 2600);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (saveStatusTimerRef.current !== null) {
        window.clearTimeout(saveStatusTimerRef.current);
      }
    };
  }, []);

  const handleSaveNow = async (customNote?: string) => {
    if (saveStatus === 'saving') return;

    // Commit any active inline text editor or numeric draft before snapshotting
    const activeEl = typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null;
    if (
      activeEl &&
      (activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'INPUT' ||
        activeEl.isContentEditable)
    ) {
      activeEl.blur();
      await new Promise((r) => window.setTimeout(r, 0));
    }

    // Cancel any pending debounced draft write so a freshly saved project is not re-marked dirty
    if (draftAutosaveTimerRef.current !== null) {
      window.clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
    }

    const latest = projectRef.current;
    const note = customNote || `Manual snapshot (Page ${currentPage})`;
    setSaveStatus('saving');
    try {
      const result = await onSaveSnapshot(latest, note);
      if (result && result.ok === false) {
        setSaveStatus('error');
        showNoticeToast(result.error || 'Failed to save snapshot.');
        return;
      }
      const savedVersion = result?.version ?? latest.version;
      lastSavedDirtySigRef.current = computeProjectDirtySignature(projectRef.current);
      setSaveStatus('saved');
      showNoticeToast(`Saved v${savedVersion} (${note})`);
      if (saveStatusTimerRef.current !== null) {
        window.clearTimeout(saveStatusTimerRef.current);
      }
      saveStatusTimerRef.current = window.setTimeout(() => {
        setSaveStatus('idle');
        saveStatusTimerRef.current = null;
      }, 2200);
    } catch (err) {
      setSaveStatus('error');
      showNoticeToast(err instanceof Error ? err.message : 'Failed to save snapshot.');
    }
  };
  handleSaveNowRef.current = handleSaveNow;

  // Dismiss Asset Insert popover when clicking/tapping outside
  useEffect(() => {
    if (!showAssetInsertMenu) return;
    const onPointerDown = (ev: MouseEvent | TouchEvent) => {
      if (assetMenuRef.current && !assetMenuRef.current.contains(ev.target as Node)) {
        setShowAssetInsertMenu(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('touchstart', onPointerDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
    };
  }, [showAssetInsertMenu]);

  // Browser Back button dismisses open modals/drawers/sheets on mobile/tablet before navigating away
  const hasAnyDismissibleOverlay =
    showPageSetupModal ||
    showVersionModal ||
    smartReplaceOpen ||
    batchStyleOpen ||
    restorationOpen ||
    pageEngineeringOpen ||
    signatureStampOpen ||
    redactionConfirmOpen ||
    (!viewport.isDesktop &&
      (showLayersPanel ||
        showInspectorDrawer ||
        showPagesDrawer ||
        mobileAddSheetOpen ||
        showMobileThumbStrip));

  const overlayHistoryPushedRef = useRef(false);
  useEffect(() => {
    if (!hasAnyDismissibleOverlay) {
      overlayHistoryPushedRef.current = false;
      return;
    }
    if (!overlayHistoryPushedRef.current) {
      overlayHistoryPushedRef.current = true;
      window.history.pushState({ pdfStudioOverlay: true }, '');
    }
    const onPopState = () => {
      overlayHistoryPushedRef.current = false;
      if (redactionConfirmOpen) setRedactionConfirmOpen(false);
      else if (signatureStampOpen) setSignatureStampOpen(false);
      else if (pageEngineeringOpen) setPageEngineeringOpen(false);
      else if (restorationOpen) setRestorationOpen(false);
      else if (batchStyleOpen) setBatchStyleOpen(false);
      else if (smartReplaceOpen) setSmartReplaceOpen(false);
      else if (showVersionModal) setShowVersionModal(false);
      else if (showPageSetupModal) setShowPageSetupModal(false);
      else {
        setMobileAddSheetOpen(false);
        setShowLayersPanel(false);
        setShowInspectorDrawer(false);
        setShowPagesDrawer(false);
        setShowMobileThumbStrip(false);
        if (viewport.isMobile) setEditorMode('edit');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [
    hasAnyDismissibleOverlay,
    redactionConfirmOpen,
    signatureStampOpen,
    pageEngineeringOpen,
    restorationOpen,
    batchStyleOpen,
    smartReplaceOpen,
    showVersionModal,
    showPageSetupModal,
    viewport.isMobile,
  ]);

  const handleToggleFavoriteFont = (fontFamily: string) => {
    if (!onUpdateSettings) return;
    const curr = settings.favoriteFonts || [];
    const next = curr.includes(fontFamily)
      ? curr.filter((f) => f !== fontFamily)
      : [fontFamily, ...curr];
    onUpdateSettings({ ...settings, favoriteFonts: next });
  };

  const handleRecordRecentFont = (fontFamily: string) => {
    if (!onUpdateSettings) return;
    const curr = settings.recentFonts || [];
    const next = [fontFamily, ...curr.filter((f) => f !== fontFamily)].slice(0, 8);
    onUpdateSettings({ ...settings, recentFonts: next });
  };

  const handleCopyFormatting = (el: DocumentElement) => {
    setCopiedFormatting(extractStylePainterPatch(el, 'appearance'));
    showNoticeToast(`Copied formatting from "${el.text?.slice(0, 18) || el.type}"`);
  };

  const handlePasteFormatting = (targetIds: string[]) => {
    if (!copiedFormatting || targetIds.length === 0) return;
    const set = new Set(targetIds);
    commitElements(
      project.elements.map((el) =>
        set.has(el.id) && !el.locked
          ? {
              ...el,
              ...copiedFormatting,
              eraseOriginal: el.isUserAdded ? false : true,
            }
          : el
      ),
      true,
      'Paste Formatting',
      `Applied copied typography & colors to ${targetIds.length} element(s)`
    );
    showNoticeToast(`Pasted formatting to ${targetIds.length} element(s)`);
  };

  const handleStartStylePainter = (
    el: DocumentElement,
    mode: 'appearance' | 'appearance_and_geometry'
  ) => {
    if (stylePainter.active && stylePainter.mode === mode) {
      setStylePainter({ active: false, mode });
      setActiveTool('select');
      showNoticeToast('Style Painter deactivated');
      return;
    }
    setStylePainter({
      active: true,
      mode,
      sourceElementId: el.id,
      sourceStyle: extractStylePainterPatch(el, mode),
    });
    setActiveTool('style_painter');
    showNoticeToast(
      `Style Painter active (${mode === 'appearance' ? 'Appearance Only' : 'Full Box & Style'}) — click target element`
    );
  };

  const handleToggleTool = (tool: ActiveEditorTool) => {
    const next = toggleEditorTool(activeTool, tool, stylePainter.active);
    setActiveTool(next.activeTool);
    if (!next.stylePainterActive && stylePainter.active) {
      setStylePainter({ active: false, mode: stylePainter.mode });
    }
    if (next.activeTool === 'select' && tool !== 'select') {
      setActiveCategory(defaultCategoryForTool(tool));
    }
  };

  const handleRunFavoriteTool = (toolId: string) => {
    if (isToolHidden(toolId)) return;
    if (['text', 'rect', 'circle', 'line', 'table', 'qr_code', 'barcode'].includes(toolId)) {
      addNewElement(toolId as 'text' | 'rect' | 'circle' | 'line' | 'table' | 'qr_code' | 'barcode');
      return;
    }
    if (toolId === 'image') {
      imageUploadRef.current?.click();
      return;
    }
    if (toolId === 'signature') {
      setSignatureModalInitialTab('signature');
      setSignatureStampOpen(true);
      return;
    }
    if (toolId === 'redact') {
      setActiveCategory('annotate');
      handleToggleTool('redact');
      setToolbarExpanded(true);
      return;
    }
    if (toolId === 'measure') {
      setActiveCategory('measure');
      handleToggleTool('measure');
      setToolbarExpanded(true);
    }
  };

  const handleToggleSnapAndGuides = () => {
    const next = toggleSyncedSnapAndGuides(snapToGrid, showGuides);
    setSnapToGrid(next.snapToGrid);
    setShowGuides(next.showGuides);
  };

  const handleStylePaintTarget = (targetId: string) => {
    if (!stylePainter.active || !stylePainter.sourceStyle) return;
    const currProj = projectRef.current;
    const target = currProj.elements.find((e) => e.id === targetId);
    if (!target || target.locked) return;
    commitElements(
      currProj.elements.map((el) =>
        el.id === targetId
          ? {
              ...el,
              ...stylePainter.sourceStyle,
              eraseOriginal: el.isUserAdded ? false : true,
            }
          : el
      ),
      true,
      'Style Painter',
      `Applied style painter to "${target.text?.slice(0, 18) || target.type}"`
    );
    setSelectedIds([targetId]);
    setStylePainter({ active: false, mode: stylePainter.mode });
    setActiveTool('select');
    showNoticeToast('Style applied');
  };

  const handleCanvasCreateElement = (newEl: DocumentElement) => {
    commitElements(
      [...projectRef.current.elements, newEl],
      true,
      `Add ${newEl.type}`,
      `Created ${newEl.type} on Page ${currentPage}`
    );
    setSelectedIds([newEl.id]);
    setInspectorTab('element');
    const keepActiveTools: ActiveEditorTool[] = [
      'draw',
      'measure',
      'highlight',
      'underline_annot',
      'strikeout_annot',
      'redact',
    ];
    if (!keepActiveTools.includes(activeTool)) {
      setActiveTool('select');
    }
  };

  const pendingRedactionCount = useMemo(
    () =>
      project.elements.filter(
        (e) => e.type === 'redaction' && e.visible && !e.redactionApplied
      ).length,
    [project.elements]
  );

  const selectCategory = (cat: EditorToolCategory) => {
    if (activeCategory === cat) {
      setToolbarExpanded((v) => !v);
      return;
    }
    setActiveCategory(cat);
    setToolbarExpanded(true);
    if (cat === 'select') setActiveTool('select');
    else if (cat === 'text') setActiveTool('text');
    else if (cat === 'shapes') setActiveTool('rect');
    else if (cat === 'draw') setActiveTool('draw');
    else if (cat === 'annotate') setActiveTool('highlight');
    else if (cat === 'measure') setActiveTool('measure');
    else setActiveTool('select');
    if (stylePainter.active) {
      setStylePainter({ active: false, mode: stylePainter.mode });
    }
  };

  const stageInteractionMode: 'preview' | 'edit' =
    editorMode === 'preview' ? 'preview' : 'edit';

  const handleSelectMode = (mode: EditorMode) => {
    if (viewport.isMobile) {
      if (mode === 'layers' && showLayersPanel) {
        setShowLayersPanel(false);
        setEditorMode('edit');
        return;
      }
      if (mode === 'properties' && showInspectorDrawer) {
        setShowInspectorDrawer(false);
        setEditorMode('edit');
        return;
      }
      if (mode === 'pages') {
        setShowLayersPanel(false);
        setShowInspectorDrawer(false);
        setMobileAddSheetOpen(false);
        setShowMobileThumbStrip((v) => {
          const next = !v;
          setEditorMode(next ? 'pages' : 'edit');
          return next;
        });
        return;
      }
      setEditorMode(mode);
      setShowLayersPanel(mode === 'layers');
      setShowInspectorDrawer(mode === 'properties');
      setShowPagesDrawer(false);
      if (mode === 'layers' || mode === 'properties') {
        setMobileSheetSnap('medium');
        setMobileAddSheetOpen(false);
        setShowMobileThumbStrip(false);
      } else {
        setShowMobileThumbStrip(false);
      }
    } else if (viewport.isTablet) {
      setEditorMode(mode);
      if (mode === 'layers') {
        setShowLayersPanel((v) => !v);
        setShowPagesDrawer(false);
      } else if (mode === 'properties') {
        setShowInspectorDrawer((v) => !v);
      } else if (mode === 'pages') {
        setShowPagesDrawer((v) => !v);
        setShowLayersPanel(false);
      }
    } else {
      setEditorMode(mode);
    }
  };

  const startResizeSidePanel = (
    side: 'layers' | 'inspector',
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = side === 'layers' ? layersWidthPx : inspectorWidthPx;
    let latestWidth = startWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      if (side === 'layers') {
        latestWidth = Math.max(176, Math.min(340, startWidth + dx));
        setLayersWidthPx(latestWidth);
      } else {
        latestWidth = Math.max(264, Math.min(440, startWidth - dx));
        setInspectorWidthPx(latestWidth);
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (onUpdateSettings) {
        onUpdateSettings({
          ...settings,
          ...(side === 'layers'
            ? { layersPanelWidthPx: latestWidth }
            : { inspectorWidthPx: latestWidth }),
        });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const isWorkspaceMaximized =
    viewport.isDesktop && !showLayersPanel && !showDesktopInspector;

  const toggleMaximizeWorkspace = () => {
    if (isWorkspaceMaximized) {
      setShowLayersPanel(true);
      setShowDesktopInspector(true);
    } else {
      setShowLayersPanel(false);
      setShowDesktopInspector(false);
    }
  };

  const renderLayersList = (touchFriendly: boolean, hideHeader = false) => (
    <div className="flex flex-col h-full overflow-hidden">
      {!hideHeader && (
        <div className="px-3 py-2.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between text-xs font-semibold text-[#101010] dark:text-white shrink-0">
          <span>Layers (Page {currentPage})</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-normal text-[#888888] dark:text-[#858585] tabular-nums">
              {pageElements.length}
            </span>
            {!viewport.isDesktop && (
              <button
                type="button"
                onClick={() => {
                  setShowLayersPanel(false);
                  if (viewport.isMobile) setEditorMode('edit');
                }}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white"
                aria-label="Close layers"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {reviewQueueCount > 0 && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{reviewQueueCount} flagged for review</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-black/10 dark:divide-white/10 pb-safe">
        {pageElements.map((el) => {
          const isSel = selectedIds.includes(el.id);
          return (
            <div
              key={el.id}
              onClick={() => {
                setSelectedIds([el.id]);
                if (viewport.isMobile) {
                  setInspectorTab('element');
                }
              }}
              className={`px-3 ${
                touchFriendly ? 'min-h-[48px] py-2' : 'py-2'
              } flex items-center justify-between gap-1.5 text-xs cursor-pointer transition-colors ${
                isSel
                  ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                  : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{el.text || el.type}</div>
                <div className="text-[10px] text-[#888888] dark:text-[#858585] truncate">
                  {el.type}
                  {el.blockId ? ` · ${el.blockId}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {el.needsReview && (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mr-0.5" />
                )}
                <button
                  type="button"
                  title="Bring Forward"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReorderElement(el.id, 'forward');
                  }}
                  className={`${
                    touchFriendly ? 'min-w-[36px] min-h-[36px]' : 'p-1'
                  } flex items-center justify-center text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white`}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Send Backward"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReorderElement(el.id, 'backward');
                  }}
                  className={`${
                    touchFriendly ? 'min-w-[36px] min-h-[36px]' : 'p-1'
                  } flex items-center justify-center text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white`}
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpdateElement(el.id, { visible: !el.visible });
                  }}
                  className={`${
                    touchFriendly ? 'min-w-[36px] min-h-[36px]' : 'p-1'
                  } flex items-center justify-center text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white`}
                >
                  {el.visible ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUpdateElement(el.id, { locked: !el.locked });
                  }}
                  className={`${
                    touchFriendly ? 'min-w-[36px] min-h-[36px]' : 'p-1'
                  } flex items-center justify-center text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white`}
                >
                  {el.locked ? (
                    <Lock className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
                  ) : (
                    <Unlock className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderPagesDrawerContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between text-xs font-semibold text-[#101010] dark:text-white shrink-0">
        <span>Pages ({project.pageCount})</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleDuplicatePage}
            className="min-h-[36px] px-2.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[11px] font-medium flex items-center gap-1"
          >
            <CopyPlus className="w-3.5 h-3.5" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              setShowPagesDrawer(false);
              if (viewport.isMobile) setEditorMode('edit');
            }}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white"
            aria-label="Close pages"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 tablet:grid-cols-1 gap-3 pb-safe">
        {Array.from({ length: project.pageCount }, (_, i) => i + 1).map((pageNum) => {
          const thumb =
            project.originalPages.find((p) => p.pageNumber === pageNum)
              ?.previewImageDataUrl || thumbnails[pageNum];
          const isActive = pageNum === currentPage;
          const elCount = project.elements.filter(
            (e) => e.pageNumber === pageNum
          ).length;
          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => {
                setCurrentPage(pageNum);
                setSelectedIds([]);
                if (viewport.isMobile) {
                  setShowPagesDrawer(false);
                  setEditorMode('edit');
                }
              }}
              className={`p-2 rounded-xl border text-left transition-colors ${
                isActive
                  ? 'studio-active-surface'
                  : 'border-black/10 dark:border-white/12 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
              }`}
            >
              <div className="aspect-[3/4] w-full rounded border border-black/10 dark:border-white/12 bg-white overflow-hidden flex items-center justify-center">
                {thumb ? (
                  <img
                    src={thumb}
                    alt={`Page ${pageNum}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-[11px] font-mono text-[#888888]">
                    P{pageNum}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-[#101010] dark:text-white tabular-nums">
                  Page {pageNum}
                </span>
                <span className="text-[#888888] dark:text-[#858585] tabular-nums">{elCount} el</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-black/10 dark:border-white/12 shrink-0">
        <button
          type="button"
          onClick={() => {
            setShowPagesDrawer(false);
            setShowPageSetupModal(true);
          }}
          className="w-full min-h-[44px] rounded-xl border border-black/15 dark:border-white/15 bg-black/[0.04] dark:bg-white/[0.07] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] text-[#101010] dark:text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Page Size, Copies & Margins
        </button>
      </div>
    </div>
  );

  const primarySelected = selectedElements[0] || null;
  const isTextLikeSelection =
    primarySelected &&
    primarySelected.type !== 'image' &&
    primarySelected.type !== 'line' &&
    primarySelected.type !== 'shape' &&
    primarySelected.type !== 'border';

  return (
    <div className="flex-1 flex flex-col h-full desktop:h-screen overflow-hidden relative">
      {/* Desktop & Tablet 10-Category Expandable Workstation Toolbar */}
      {!viewport.isMobile && (
        <div className="shrink-0 z-20 flex flex-col border-b border-black/10 dark:border-white/12 glass-level-2">
          {/* Row 1: Panels, Undo/Redo, 10 Tool Categories (scrollable), Pinned View/Zoom/Page/Save */}
          <header className="h-11 px-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
              <button
                type="button"
                title="Toggle Layers"
                onClick={() => setShowLayersPanel((v) => !v)}
                className={`p-1.5 rounded-lg transition-colors ${
                  showLayersPanel
                    ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                    : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                }`}
              >
                <Layers className="w-4 h-4" />
              </button>

              <button
                type="button"
                title="Page Thumbnails"
                onClick={() => setShowPagesDrawer((v) => !v)}
                className={`p-1.5 rounded-lg transition-colors ${
                  showPagesDrawer
                    ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                    : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                }`}
              >
                <BookOpen className="w-4 h-4" />
              </button>

              {viewport.isDesktop ? (
                <button
                  type="button"
                  title="Toggle Properties Inspector"
                  onClick={() => setShowDesktopInspector((v) => !v)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    showDesktopInspector
                      ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                      : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                  }`}
                >
                  <PanelRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  title="Properties & AI"
                  onClick={() => setShowInspectorDrawer((v) => !v)}
                  className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                    showInspectorDrawer
                      ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                      : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  Props
                </button>
              )}

              {viewport.isDesktop && (
                <button
                  type="button"
                  title={isWorkspaceMaximized ? 'Restore Side Panels' : 'Maximize Canvas'}
                  onClick={toggleMaximizeWorkspace}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isWorkspaceMaximized
                      ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                      : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                  }`}
                >
                  {isWorkspaceMaximized ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              )}

              <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-1" />

              <button
                type="button"
                title={undoStack.length > 0 ? `Undo: ${undoStack[undoStack.length - 1].label}` : 'Undo'}
                disabled={undoStack.length === 0}
                onClick={handleUndo}
                className="p-1.5 rounded-lg text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-35"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                title={redoStack.length > 0 ? `Redo: ${redoStack[redoStack.length - 1].label}` : 'Redo'}
                disabled={redoStack.length === 0}
                onClick={handleRedo}
                className="p-1.5 rounded-lg text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-35"
              >
                <Redo2 className="w-4 h-4" />
              </button>

              <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-1" />

              {/* 10 Tool Category Tabs */}
              <div className="flex items-center gap-0.5" role="tablist" aria-label="Editor Tool Categories">
                {(
                  [
                    ['select', 'Select', 'V', MousePointer2],
                    ['text', 'Text', 'T', TypeIcon],
                    ['images', 'Images', 'I', ImageIcon],
                    ['shapes', 'Shapes', 'S', Square],
                    ['draw', 'Draw', 'P', Pencil],
                    ['annotate', 'Annotate', 'A', Highlighter],
                    ['arrange', 'Arrange', 'L', Group],
                    ['pages', 'Pages', 'G', FileCog],
                    ['measure', 'Measure', 'M', Ruler],
                    ['inspect', 'Inspect', 'K', ShieldCheck],
                  ] as const
                ).map(([cat, label, shortcut, Icon]) => {
                  const isActive = activeCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      title={`${label} (${shortcut})`}
                      onClick={() => selectCategory(cat)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505] shadow-sm'
                          : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden desktop:inline">{label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                title={toolbarExpanded ? 'Collapse Tool Ribbon' : 'Expand Tool Ribbon'}
                onClick={() => setToolbarExpanded((v) => !v)}
                className="p-1 rounded-lg text-[#888888] hover:text-[#101010] dark:hover:text-white"
              >
                {toolbarExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                title="Preview vs Edit Mode"
                onClick={() =>
                  setEditorMode((m) => (m === 'preview' ? 'edit' : 'preview'))
                }
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 whitespace-nowrap ${
                  editorMode === 'preview'
                    ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505]'
                    : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                {editorMode === 'preview' ? 'Preview' : 'Edit'}
              </button>

              <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />

              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.max(0.3, Number((z - 0.15).toFixed(2))))
                }
                className="p-1 rounded-lg text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono tabular-nums w-10 text-center text-[#101010] dark:text-white">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))
                }
                className="p-1 rounded-lg text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />

              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded-lg text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-35"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs tabular-nums text-[#101010] dark:text-white whitespace-nowrap">
                {currentPage} / {project.pageCount}
              </span>
              <button
                type="button"
                disabled={currentPage >= project.pageCount}
                onClick={() =>
                  setCurrentPage((p) => Math.min(project.pageCount, p + 1))
                }
                className="p-1 rounded-lg text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-35"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                title="Open AI-Enhanced Analysis & AI Editing Assistant"
                onClick={() => {
                  setInspectorTab('ai');
                  if (viewport.isDesktop) {
                    setShowDesktopInspector(true);
                  } else {
                    setShowInspectorDrawer(true);
                  }
                }}
                className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 whitespace-nowrap ${
                  inspectorTab === 'ai'
                    ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                    : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Assist
              </button>

              <button
                type="button"
                title="Save snapshot & persist project (Ctrl/Cmd+S)"
                disabled={saveStatus === 'saving'}
                onClick={() => void handleSaveNow()}
                className="ml-0.5 px-3 py-1 rounded-xl text-xs font-medium bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] shadow-sm flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                {saveStatus === 'saving'
                  ? 'Saving...'
                  : saveStatus === 'saved'
                  ? `Saved v${Math.max(1, project.version - 1)}`
                  : 'Save'}
              </button>
            </div>
          </header>

          {/* Row 2: Contextual Expandable Tool Ribbon */}
          <AnimatePresence initial={false}>
            {toolbarExpanded && (
              <motion.div
                key={`subbar-${activeCategory}`}
                initial={prefersReduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{
                  opacity: 1,
                  height: 'auto',
                  transition: { duration: MOTION_DURATION.fast },
                }}
                exit={
                  prefersReduced
                    ? { opacity: 0 }
                    : { opacity: 0, height: 0, transition: { duration: MOTION_DURATION.instant } }
                }
                className="px-3 py-1.5 border-t border-black/10 dark:border-white/10 glass-level-1 flex items-center gap-1.5 text-[11px] overflow-x-auto no-scrollbar"
              >
                {activeCategory === 'select' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleToggleTool('select')}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        activeTool === 'select' && !stylePainter.active
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <MousePointer2 className="w-3.5 h-3.5" />
                      Pointer Select
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleTool('marquee')}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        activeTool === 'marquee'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <BoxSelect className="w-3.5 h-3.5" />
                      Marquee Box
                    </button>
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      disabled={selectedIds.length === 0}
                      onClick={handleCopy}
                      className="px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 flex items-center gap-1 whitespace-nowrap"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </button>
                    <button
                      type="button"
                      disabled={clipboard.length === 0}
                      onClick={handlePaste}
                      className="px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 flex items-center gap-1 whitespace-nowrap"
                    >
                      <Clipboard className="w-3.5 h-3.5" />
                      Paste
                    </button>
                    <button
                      type="button"
                      disabled={selectedIds.length === 0}
                      onClick={handleDuplicateSelected}
                      className="px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 flex items-center gap-1 whitespace-nowrap"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                      Duplicate
                    </button>
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      disabled={!primarySelected}
                      onClick={() =>
                        primarySelected &&
                        handleStartStylePainter(primarySelected, 'appearance')
                      }
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap disabled:opacity-35 ${
                        stylePainter.active && stylePainter.mode === 'appearance'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Paintbrush className="w-3.5 h-3.5" />
                      Paint Style
                    </button>
                    <button
                      type="button"
                      disabled={!primarySelected}
                      onClick={() =>
                        primarySelected &&
                        handleStartStylePainter(
                          primarySelected,
                          'appearance_and_geometry'
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap disabled:opacity-35 ${
                        stylePainter.active &&
                        stylePainter.mode === 'appearance_and_geometry'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Paintbrush className="w-3.5 h-3.5" />
                      Paint Style + Box
                    </button>
                  </>
                )}

                {activeCategory === 'text' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleToggleTool('text')}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        activeTool === 'text'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <TypeIcon className="w-3.5 h-3.5" />
                      Draw Text Box
                    </button>
                    <button
                      type="button"
                      onClick={() => addNewElement('text')}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Insert Text Block
                    </button>
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setSmartReplaceOpen(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Replace className="w-3.5 h-3.5" />
                      Smart Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchStyleOpen(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Batch Style Pages
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSearchBar((v) => !v);
                        onTrackRecentTool?.('search');
                      }}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        showSearchBar
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Search className="w-3.5 h-3.5" />
                      Quick Find Bar
                    </button>
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      disabled={!primarySelected}
                      onClick={() =>
                        primarySelected && handleCopyFormatting(primarySelected)
                      }
                      className="px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 whitespace-nowrap"
                    >
                      Copy Format
                    </button>
                    <button
                      type="button"
                      disabled={!copiedFormatting || selectedIds.length === 0}
                      onClick={() => handlePasteFormatting(selectedIds)}
                      className="px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 whitespace-nowrap"
                    >
                      Paste Format
                    </button>
                  </>
                )}

                {activeCategory === 'images' && (
                  <>
                    <button
                      type="button"
                      onClick={() => imageUploadRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Upload Image / Logo
                    </button>
                    <div ref={assetMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowAssetInsertMenu((v) => !v)}
                        className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                          showAssetInsertMenu
                            ? 'studio-active-surface'
                            : 'hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        Asset Library
                      </button>
                      <AnimatePresence>
                        {showAssetInsertMenu && (
                          <motion.div
                            key="asset-insert-popover"
                            variants={popoverVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="fixed mt-2 w-64 rounded-2xl border glass-level-4 z-50 p-2.5 text-xs space-y-2 max-h-80 overflow-y-auto origin-top-left"
                          >
                            <div className="font-semibold text-[#101010] dark:text-white px-1">
                              Saved Logos &amp; Images ({savedImages.length})
                            </div>
                            {savedImages.length === 0 ? (
                              <div className="px-1 text-[11px] text-[#888888] dark:text-[#858585]">
                                None saved. Upload in Asset Library.
                              </div>
                            ) : (
                              savedImages.map((img) => (
                                <button
                                  key={img.id}
                                  type="button"
                                  onClick={() => handleInsertAssetImage(img)}
                                  className="w-full px-2 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] flex items-center gap-2 text-left transition-colors"
                                >
                                  <img
                                    src={img.dataUrl}
                                    alt={img.name}
                                    className="w-6 h-6 object-contain bg-white rounded border border-black/15"
                                  />
                                  <span className="truncate flex-1">{img.name}</span>
                                </button>
                              ))
                            )}
                            <div className="font-semibold text-[#101010] dark:text-white px-1 pt-1 border-t border-black/10 dark:border-white/12">
                              Saved Shapes ({savedShapes.length})
                            </div>
                            {savedShapes.length === 0 ? (
                              <div className="px-1 text-[11px] text-[#888888] dark:text-[#858585]">
                                None saved. Create in Asset Library.
                              </div>
                            ) : (
                              savedShapes.map((shp) => (
                                <button
                                  key={shp.id}
                                  type="button"
                                  onClick={() => handleInsertAssetShape(shp)}
                                  className="w-full px-2 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] flex items-center justify-between text-left transition-colors"
                                >
                                  <span className="truncate">{shp.name}</span>
                                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                    {shp.shapeKind}
                                  </span>
                                </button>
                              ))
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRestorationOpen(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <ScanLine className="w-3.5 h-3.5" />
                      Scan Restoration &amp; OCR
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureModalInitialTab('signature');
                        setSignatureStampOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Signature Pad
                    </button>
                  </>
                )}

                {activeCategory === 'shapes' && (
                  <>
                    {(
                      [
                        ['rect', 'Rectangle', Square],
                        ['circle', 'Circle / Ellipse', Circle],
                        ['line', 'Line', Minus],
                        ['arrow', 'Arrow', ArrowUpRight],
                      ] as const
                    ).map(([toolId, label, Icon]) => (
                      <button
                        key={toolId}
                        type="button"
                        onClick={() => handleToggleTool(toolId)}
                        className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                          activeTool === toolId
                            ? 'studio-active-surface'
                            : 'hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => addNewElement('table')}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Table2 className="w-3.5 h-3.5" />
                      Insert Table
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateDocumentBlock}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <BoxSelect className="w-3.5 h-3.5" />
                      Document Block
                    </button>
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => addNewElement('qr_code')}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      QR Code
                    </button>
                    <button
                      type="button"
                      onClick={() => addNewElement('barcode')}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <ScanBarcode className="w-3.5 h-3.5" />
                      Barcode
                    </button>
                  </>
                )}

                {activeCategory === 'draw' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleToggleTool('draw')}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        activeTool === 'draw'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Freehand Ink Pen
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleTool('arrow')}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        activeTool === 'arrow'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Vector Arrow
                    </button>
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureModalInitialTab('signature');
                        setSignatureStampOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Signature Pad
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureModalInitialTab('stamp');
                        setSignatureStampOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Stamp className="w-3.5 h-3.5" />
                      Dated Stamp
                    </button>
                  </>
                )}

                {activeCategory === 'annotate' && (
                  <>
                    {(
                      [
                        ['highlight', 'Highlight', Highlighter],
                        ['underline_annot', 'Underline', Underline],
                        ['strikeout_annot', 'Strikeout', Strikethrough],
                        ['note', 'Sticky Note', MessageSquare],
                        ['callout', 'Callout', MessageSquarePlus],
                      ] as const
                    ).map(([toolId, label, Icon]) => (
                      <button
                        key={toolId}
                        type="button"
                        onClick={() => handleToggleTool(toolId)}
                        className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                          activeTool === toolId
                            ? 'studio-active-surface'
                            : 'hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureModalInitialTab('stamp');
                        setSignatureStampOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Stamp className="w-3.5 h-3.5" />
                      Stamp / Sign
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleTool('redact')}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        activeTool === 'redact'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Mark Redaction
                    </button>
                    <button
                      type="button"
                      onClick={() => setRedactionConfirmOpen(true)}
                      className="px-2.5 py-1 rounded-lg border border-black/20 dark:border-white/20 hover:bg-black/10 dark:hover:bg-white/10 font-semibold flex items-center gap-1 whitespace-nowrap"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Apply Redactions ({pendingRedactionCount})
                    </button>
                  </>
                )}

                {activeCategory === 'arrange' && (
                  <>
                    <button
                      type="button"
                      disabled={selectedIds.length === 0}
                      onClick={handleGroupToggle}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      {selectedElements[0]?.groupId ? (
                        <Ungroup className="w-3.5 h-3.5" />
                      ) : (
                        <Group className="w-3.5 h-3.5" />
                      )}
                      {selectedElements[0]?.groupId ? 'Ungroup' : 'Group'}
                    </button>
                    {(['left', 'center', 'right'] as const).map((al) => (
                      <button
                        key={al}
                        type="button"
                        disabled={selectedIds.length < 2}
                        onClick={() => handleAlignSelected(al)}
                        className="px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 capitalize whitespace-nowrap"
                      >
                        Align {al}
                      </button>
                    ))}
                    <div className="h-4 w-px bg-black/15 dark:bg-white/15 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setShowRulers((v) => !v)}
                      className={`px-2 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap ${
                        showRulers ? 'studio-active-surface' : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      Rulers
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowGrid((v) => !v)}
                      className={`px-2 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap ${
                        showGrid ? 'studio-active-surface' : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5" />
                      Grid
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleSnapAndGuides}
                      className={`px-2 py-1 rounded-lg flex items-center gap-1 whitespace-nowrap ${
                        snapToGrid && showGuides
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Magnet className="w-3.5 h-3.5" />
                      Snap &amp; Guides
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCropMode((v) => {
                          const next = !v;
                          if (next) setInspectorTab('page');
                          return next;
                        });
                      }}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        cropMode ? 'studio-active-surface' : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Crop className="w-3.5 h-3.5" />
                      Visual Crop
                    </button>
                  </>
                )}

                {activeCategory === 'pages' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPageEngineeringOpen(true)}
                      className="px-2.5 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <FileCog className="w-3.5 h-3.5" />
                      Page Engineering (Insert / Split / Merge / Reorder)
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPageSetupModal(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      Paper Size, Copies &amp; Margins
                    </button>
                    <button
                      type="button"
                      onClick={handleDuplicatePage}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                      Duplicate Page {currentPage}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVersionModal(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <History className="w-3.5 h-3.5" />
                      History &amp; Timeline ({undoStack.length})
                    </button>
                  </>
                )}

                {activeCategory === 'measure' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleToggleTool('measure')}
                      className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap ${
                        activeTool === 'measure'
                          ? 'studio-active-surface'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      Click &amp; Drag Distance Caliper
                    </button>
                    <span className="text-[#888888] ml-1">Unit:</span>
                    {(['mm', 'cm', 'in', 'pt'] as MeasurementUnit[]).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setMeasureUnit(u)}
                        className={`px-2 py-0.5 rounded-lg font-mono uppercase ${
                          measureUnit === u
                            ? 'studio-active-surface'
                            : 'hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </>
                )}

                {activeCategory === 'inspect' && (
                  <>
                    {onNavigateSection && (
                      <>
                        <button
                          type="button"
                          onClick={() => onNavigateSection('scan-inspector')}
                          className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                        >
                          <ScanSearch className="w-3.5 h-3.5" />
                          Scan Inspector
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigateSection('preflight')}
                          className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Preflight Quality Check
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigateSection('compare')}
                          className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                        >
                          <GitCompare className="w-3.5 h-3.5" />
                          Compare Documents
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setRestorationOpen(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <ScanLine className="w-3.5 h-3.5" />
                      Scan Restoration &amp; OCR
                    </button>
                    <button
                      type="button"
                      onClick={() => setRedactionConfirmOpen(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Redaction Sanitizer ({pendingRedactionCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVersionModal(true)}
                      className="px-2.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      <History className="w-3.5 h-3.5" />
                      Version History
                    </button>
                  </>
                )}

                {stylePainter.active && (
                  <div className="ml-auto flex items-center gap-2 px-2.5 py-0.5 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] shrink-0">
                    <span>Style Painter Active — click target element</span>
                    <button
                      type="button"
                      onClick={() => {
                        setStylePainter({ active: false, mode: stylePainter.mode });
                        setActiveTool('select');
                      }}
                      className="underline font-semibold"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <input
        ref={imageUploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleImageUpload(e.target.files?.[0])}
      />

      {/* Search & Replace Bar */}
      <AnimatePresence initial={false}>
        {showSearchBar && (
          <motion.div
            key="editor-search-bar"
            variants={bannerVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="px-3 tablet:px-4 py-2 border-b glass-level-2 flex flex-wrap items-center gap-2 text-xs shrink-0 z-20"
          >
            <input
              type="text"
              placeholder="Find text..."
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              className="studio-input flex-1 min-w-[120px] min-h-[38px] tablet:min-h-0 px-2.5 py-1 rounded-xl"
            />
            <input
              type="text"
              placeholder="Replace with..."
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              className="studio-input flex-1 min-w-[120px] min-h-[38px] tablet:min-h-0 px-2.5 py-1 rounded-xl"
            />
            <button
              type="button"
              onClick={handleSearchAndReplace}
              className="min-h-[38px] tablet:min-h-0 px-3 py-1 rounded-xl bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium transition-colors active:scale-[0.98]"
            >
              Replace All
            </button>
            <button
              type="button"
              onClick={() => setShowSearchBar(false)}
              className="min-h-[38px] tablet:min-h-0 px-2 text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white transition-colors"
            >
              Close
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pinned favorite tools configured in Settings */}
      {!viewport.isMobile && (settings.favoriteTools || ['text', 'rect', 'qr_code', 'barcode']).length > 0 && (
        <div className="px-3 py-1 border-b border-black/10 dark:border-white/10 glass-level-1 flex items-center gap-1.5 text-[11px] shrink-0 overflow-x-auto no-scrollbar">
          <span className="text-[#888888] dark:text-[#858585] shrink-0">Pinned:</span>
          {(settings.favoriteTools || ['text', 'rect', 'qr_code', 'barcode']).filter((id) => !isToolHidden(id)).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => handleRunFavoriteTool(id)}
              className="px-2 py-0.5 rounded-lg border border-black/10 dark:border-white/12 glass-level-3 text-[#555555] dark:text-[#B5B5B5] hover:border-black/40 dark:hover:border-white/40 hover:text-[#101010] dark:hover:text-white capitalize transition-colors"
            >
              {({ qr_code: 'QR Code', barcode: 'Barcode', image: 'Image', signature: 'Signature', redact: 'Redact', measure: 'Measure' } as Record<string, string>)[id] || id.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Desktop Recent Tools Strip & Style Feedback */}
      {!viewport.isMobile &&
        ((settings.recentTools && settings.recentTools.length > 0 && !isToolHidden('recentBar')) ||
          styleToast) && (
          <div className="px-3 py-1 border-b border-black/10 dark:border-white/10 glass-level-1 flex items-center justify-between gap-2 text-[11px] shrink-0 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[#888888] dark:text-[#858585]">Recent:</span>
              {(settings.recentTools || []).slice(0, 6).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (
                      t === 'text' ||
                      t === 'rect' ||
                      t === 'circle' ||
                      t === 'line' ||
                      t === 'table' ||
                      t === 'qr_code' ||
                      t === 'barcode'
                    ) {
                      addNewElement(t);
                    } else if (t === 'image') {
                      imageUploadRef.current?.click();
                    } else if (t === 'duplicate') {
                      handleDuplicateSelected();
                    } else if (t === 'group') {
                      handleGroupToggle();
                    } else if (t === 'crop') {
                      setCropMode((v) => !v);
                    } else if (t === 'search') {
                      setShowSearchBar((v) => !v);
                    } else if (t.startsWith('align_')) {
                      handleAlignSelected(t.replace('align_', '') as AlignMode);
                    }
                  }}
                  className="px-2 py-0.5 rounded-lg border border-black/10 dark:border-white/12 glass-level-3 text-[#555555] dark:text-[#B5B5B5] hover:border-black/40 dark:hover:border-white/40 hover:text-[#101010] dark:hover:text-white capitalize transition-colors"
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <AnimatePresence>
              {styleToast && (
                <motion.span
                  key={styleToast}
                  variants={toastVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="text-[#101010] dark:text-white font-medium"
                >
                  {styleToast}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        )}

      {/* Main Workspace Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop Resizable Left Layers Panel */}
        <AnimatePresence initial={false}>
          {viewport.isDesktop && showLayersPanel && (
            <motion.div
              key="desktop-layers-panel"
              initial={prefersReduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
              animate={{
                width: 'auto',
                opacity: 1,
                transition: prefersReduced
                  ? { duration: MOTION_DURATION.instant }
                  : MOTION_SPRING.drawer,
              }}
              exit={
                prefersReduced
                  ? { opacity: 0, transition: { duration: MOTION_DURATION.instant } }
                  : {
                      width: 0,
                      opacity: 0,
                      transition: { duration: MOTION_DURATION.fast },
                    }
              }
              className="relative shrink-0 flex overflow-hidden"
            >
              <aside
                style={{ width: `${layersWidthPx}px` }}
                className="shrink-0 border-r glass-level-2 flex flex-col overflow-hidden"
              >
                {renderLayersList(false)}
              </aside>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize layers panel"
                onMouseDown={(e) => startResizeSidePanel('layers', e)}
                className="w-1.5 -ml-0.5 cursor-col-resize hover:bg-black/25 active:bg-black/40 dark:hover:bg-white/25 dark:active:bg-white/40 transition-colors z-10 shrink-0"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Desktop Pages Strip Drawer */}
        <AnimatePresence initial={false}>
          {viewport.isDesktop && showPagesDrawer && (
            <motion.aside
              key="desktop-pages-drawer"
              initial={prefersReduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
              animate={{
                width: 208,
                opacity: 1,
                transition: prefersReduced
                  ? { duration: MOTION_DURATION.instant }
                  : MOTION_SPRING.drawer,
              }}
              exit={
                prefersReduced
                  ? { opacity: 0, transition: { duration: MOTION_DURATION.instant } }
                  : {
                      width: 0,
                      opacity: 0,
                      transition: { duration: MOTION_DURATION.fast },
                    }
              }
              className="shrink-0 border-r glass-level-2 flex flex-col overflow-hidden"
            >
              {renderPagesDrawerContent()}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Central PDF Workspace (Document surface remains opaque for readability) */}
        <div className="flex-1 relative flex flex-col overflow-hidden">
          {/* Mobile Floating Liquid Glass Top Bar */}
          {viewport.isMobile && (
            <div className="absolute top-2 left-2 right-2 z-30 pt-safe pointer-events-none flex flex-col gap-1.5">
              <div className="pointer-events-auto glass-level-2 border rounded-2xl px-1.5 py-1 flex items-center justify-between gap-1">
                <div className="flex items-center gap-0.5 shrink-0">
                  {onOpenMobileNav && (
                    <button
                      type="button"
                      onClick={onOpenMobileNav}
                      aria-label="Open menu"
                      className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl text-[#101010] dark:text-white"
                    >
                      <Menu className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={undoStack.length === 0}
                    onClick={handleUndo}
                    aria-label="Undo"
                    className="min-w-[34px] min-h-[38px] flex items-center justify-center rounded-xl text-[#101010] dark:text-white disabled:opacity-30"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={redoStack.length === 0}
                    onClick={handleRedo}
                    aria-label="Redo"
                    className="min-w-[34px] min-h-[38px] flex items-center justify-center rounded-xl text-[#101010] dark:text-white disabled:opacity-30"
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Page & Quick Zoom Center Cluster */}
                <div className="flex items-center gap-1 min-w-0">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    className="min-w-[30px] min-h-[36px] flex items-center justify-center rounded-xl text-[#555555] dark:text-[#B5B5B5] disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMobileThumbStrip((v) => !v)}
                    className={`px-2.5 min-h-[34px] rounded-xl text-[11px] font-mono font-medium tabular-nums border ${
                      showMobileThumbStrip
                        ? 'studio-active-surface'
                        : 'border-black/15 dark:border-white/15 text-[#101010] dark:text-white'
                    }`}
                  >
                    {currentPage}/{project.pageCount}
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= project.pageCount}
                    onClick={() =>
                      setCurrentPage((p) => Math.min(project.pageCount, p + 1))
                    }
                    aria-label="Next page"
                    className="min-w-[30px] min-h-[36px] flex items-center justify-center rounded-xl text-[#555555] dark:text-[#B5B5B5] disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowPageSetupModal(true)}
                    aria-label="Page settings"
                    className="min-w-[36px] min-h-[38px] flex items-center justify-center rounded-xl text-[#555555] dark:text-[#B5B5B5]"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={saveStatus === 'saving'}
                    onClick={() => void handleSaveNow()}
                    className="min-h-[36px] px-2.5 rounded-xl text-xs font-medium bg-[#101010] text-white dark:bg-white dark:text-[#050505] shadow-sm flex items-center gap-1 disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saveStatus === 'saving'
                      ? 'Saving'
                      : saveStatus === 'saved'
                      ? 'Saved'
                      : 'Save'}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {styleToast && (
                  <motion.div
                    key={styleToast}
                    variants={toastVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="pointer-events-auto self-center px-3 py-1 rounded-full glass-level-3 border text-[11px] font-medium text-[#101010] dark:text-white shadow-md"
                  >
                    {styleToast}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mobile Quick Zoom Floating Pill + Collapsible Page Thumbnails */}
              <div className="flex items-center justify-between px-1">
                <div className="pointer-events-auto glass-level-2 border rounded-xl px-1.5 py-0.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.max(0.25, Number((z - 0.12).toFixed(2))))
                    }
                    aria-label="Zoom out"
                    className="min-w-[30px] min-h-[30px] flex items-center justify-center text-[#555555] dark:text-[#B5B5B5]"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono tabular-nums text-[#101010] dark:text-white px-0.5">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.min(2.5, Number((z + 0.12).toFixed(2))))
                    }
                    aria-label="Zoom in"
                    className="min-w-[30px] min-h-[30px] flex items-center justify-center text-[#555555] dark:text-[#B5B5B5]"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {(activeTool !== 'select' || stylePainter.active) && (
                    <button
                      type="button"
                      onClick={() => {
                        setStylePainter({ active: false, mode: stylePainter.mode });
                        setActiveTool('select');
                        setActiveCategory('select');
                      }}
                      className="pointer-events-auto px-2.5 min-h-[32px] rounded-xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] text-[11px] font-medium shadow-sm flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Exit {stylePainter.active ? 'Painter' : activeTool.replace(/_/g, ' ')}
                    </button>
                  )}

                  {cropMode && (
                    <button
                      type="button"
                      onClick={() => setCropMode(false)}
                      className="pointer-events-auto px-2.5 min-h-[32px] rounded-xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] text-[11px] font-medium shadow-sm flex items-center gap-1"
                    >
                      <Crop className="w-3 h-3" />
                      Done Crop
                    </button>
                  )}
                </div>
              </div>

              {/* Collapsible Mobile Page Thumbnail Navigator */}
              <AnimatePresence initial={false}>
                {showMobileThumbStrip && (
                  <motion.div
                    key="mobile-thumb-strip"
                    variants={popoverVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="pointer-events-auto glass-level-3 border rounded-2xl p-2 space-y-2 origin-top"
                  >
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[11px] font-semibold text-[#101010] dark:text-white">
                        Pages ({project.pageCount})
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleDuplicatePage}
                          className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 text-[10px] font-medium flex items-center gap-1"
                        >
                          <CopyPlus className="w-3 h-3" />
                          Dup Page
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowMobileThumbStrip(false)}
                          aria-label="Collapse thumbnails"
                          className="p-1 text-[#888888] dark:text-[#858585]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 snap-x no-scrollbar">
                      {Array.from({ length: project.pageCount }, (_, i) => i + 1).map(
                        (pageNum) => {
                          const thumb =
                            project.originalPages.find((p) => p.pageNumber === pageNum)
                              ?.previewImageDataUrl || thumbnails[pageNum];
                          const isActive = pageNum === currentPage;
                          return (
                            <button
                              key={pageNum}
                              type="button"
                              onClick={() => {
                                setCurrentPage(pageNum);
                                setSelectedIds([]);
                              }}
                              className={`snap-start shrink-0 w-16 p-1 rounded-xl border text-center transition-colors ${
                                isActive
                                  ? 'border-[#101010] bg-black/[0.06] dark:border-white dark:bg-white/[0.12]'
                                  : 'border-black/10 dark:border-white/12'
                              }`}
                            >
                              <div className="aspect-[3/4] w-full rounded-lg bg-white overflow-hidden flex items-center justify-center">
                                {thumb ? (
                                  <img
                                    src={thumb}
                                    alt={`Page ${pageNum}`}
                                    className="w-full h-full object-contain"
                                  />
                                ) : (
                                  <span className="text-[10px] font-mono text-[#888888]">
                                    P{pageNum}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[10px] font-mono tabular-nums">
                                {pageNum}
                              </div>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Central Konva PDF Stage (Document canvas stays opaque & uncluttered) */}
          <PdfCanvasStage
            pageConfig={project.pageConfig}
            backgroundImageUrl={currentMeta?.restoredPreviewDataUrl || pageBgUrl}
            originalPageSize={currentMeta}
            elements={pageElements}
            selectedIds={selectedIds}
            zoom={zoom}
            interactionMode={stageInteractionMode}
            activeTool={activeTool}
            stylePainterActive={stylePainter.active}
            currentPageNumber={currentPage}
            measureUnit={measureUnit}
            showRulers={showRulers}
            showGrid={showGrid}
            snapToGrid={snapToGrid}
            snapToObjects={settings.snapToObjects ?? true}
            snapThresholdPt={settings.snapThresholdPt ?? 6}
            showAlignmentGuides={showGuides}
            gridSizePt={settings.gridSizePt}
            cropMode={cropMode}
            fitConfig={fitConfig}
            activeSourceBox={currentLayout.sourceBox}
            detectedContentBox={currentMeta?.contentBBox}
            highlightedElementId={highlightedElementId}
            onZoomChange={setZoom}
            onOpenProperties={() => {
              setInspectorTab('element');
              if (viewport.isMobile) {
                handleSelectMode('properties');
              } else if (viewport.isTablet) {
                setShowInspectorDrawer(true);
              } else {
                setShowDesktopInspector(true);
              }
            }}
            onDuplicateElement={handleDuplicateElementById}
            onDeleteElement={handleDeleteElementById}
            onReorderElement={handleReorderElement}
            onChangeCropRect={handleChangeCropRect}
            onSelectIds={setSelectedIds}
            onUpdateElement={handleUpdateElement}
            onUpdateElementsBatch={handleUpdateElementsBatch}
            onCreateElement={handleCanvasCreateElement}
            onStylePaintTarget={handleStylePaintTarget}
          />

          {/* Floating Contextual Selection Toolbar (Desktop & Mobile) */}
          <AnimatePresence>
            {selectedElements.length > 0 && editorMode !== 'preview' && (
              <motion.div
                key="floating-selection-toolbar"
                variants={floatingToolbarVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`absolute left-1/2 -translate-x-1/2 z-30 max-w-[94vw] pointer-events-auto ${
                  viewport.isMobile ? 'bottom-3' : 'bottom-4'
                }`}
              >
                <div className="glass-level-3 border rounded-2xl px-2 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar">
                  <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] px-1.5 tabular-nums whitespace-nowrap">
                    {selectedElements.length === 1
                      ? primarySelected?.type.replace('_', ' ')
                      : `${selectedElements.length} selected`}
                  </span>
                  <div className="h-4 w-px bg-black/15 dark:bg-white/15" />

                  {selectedElements.length === 1 && isTextLikeSelection && primarySelected && (
                    <>
                      <button
                        type="button"
                        title="Toggle Bold"
                        onClick={() =>
                          handleUpdateElement(primarySelected.id, {
                            fontWeight:
                              primarySelected.fontWeight === 'bold' ? 'normal' : 'bold',
                            eraseOriginal: primarySelected.isUserAdded ? false : true,
                          })
                        }
                        className={`min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl transition-colors ${
                          primarySelected.fontWeight === 'bold'
                            ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                            : 'text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                        }`}
                      >
                        <Bold className="w-3.5 h-3.5" />
                      </button>
                      {(['left', 'center', 'right'] as const).map((al) => (
                        <button
                          key={al}
                          type="button"
                          title={`Align ${al}`}
                          onClick={() =>
                            handleUpdateElement(primarySelected.id, {
                              align: al,
                              eraseOriginal: primarySelected.isUserAdded ? false : true,
                            })
                          }
                          className={`min-w-[32px] min-h-[34px] flex items-center justify-center rounded-xl transition-colors ${
                            primarySelected.align === al
                              ? 'bg-black/[0.08] text-[#101010] dark:bg-white/[0.14] dark:text-white'
                              : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
                          }`}
                        >
                          {al === 'left' ? (
                            <AlignLeft className="w-3.5 h-3.5" />
                          ) : al === 'center' ? (
                            <AlignCenter className="w-3.5 h-3.5" />
                          ) : (
                            <AlignRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ))}
                    </>
                  )}

                  {selectedElements.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleAlignSelected('left')}
                        className="px-2 min-h-[34px] rounded-xl text-[11px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                      >
                        Align L
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAlignSelected('center')}
                        className="px-2 min-h-[34px] rounded-xl text-[11px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                      >
                        Align C
                      </button>
                      <button
                        type="button"
                        onClick={handleGroupToggle}
                        className="px-2 min-h-[34px] rounded-xl text-[11px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                      >
                        {primarySelected?.groupId ? 'Ungroup' : 'Group'}
                      </button>
                      <button
                        type="button"
                        onClick={handleConvertSelectionToTable}
                        className="px-2 min-h-[34px] rounded-xl text-[11px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                      >
                        To Table
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    title="Duplicate"
                    onClick={handleDuplicateSelected}
                    className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    <CopyPlus className="w-3.5 h-3.5" />
                  </button>

                  {selectedElements.length === 1 && primarySelected && (
                    <button
                      type="button"
                      title={primarySelected.locked ? 'Unlock' : 'Lock'}
                      onClick={() =>
                        handleUpdateElement(primarySelected.id, {
                          locked: !primarySelected.locked,
                        })
                      }
                      className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      {primarySelected.locked ? (
                        <Lock className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  {viewport.isMobile && (
                    <button
                      type="button"
                      onClick={() => {
                        setInspectorTab('element');
                        handleSelectMode('properties');
                      }}
                      className="px-2.5 min-h-[34px] rounded-xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] text-[11px] font-medium flex items-center gap-1"
                    >
                      <Sliders className="w-3 h-3" />
                      Edit
                    </button>
                  )}

                  <button
                    type="button"
                    title="Delete"
                    onClick={handleDeleteSelected}
                    className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Desktop Resizable Right Properties Inspector */}
        <AnimatePresence initial={false}>
          {viewport.isDesktop && showDesktopInspector && (
            <motion.div
              key="desktop-properties-inspector"
              initial={prefersReduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
              animate={{
                width: 'auto',
                opacity: 1,
                transition: prefersReduced
                  ? { duration: MOTION_DURATION.instant }
                  : MOTION_SPRING.drawer,
              }}
              exit={
                prefersReduced
                  ? { opacity: 0, transition: { duration: MOTION_DURATION.instant } }
                  : {
                      width: 0,
                      opacity: 0,
                      transition: { duration: MOTION_DURATION.fast },
                    }
              }
              className="relative shrink-0 flex overflow-hidden"
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize properties inspector"
                onMouseDown={(e) => startResizeSidePanel('inspector', e)}
                className="w-1.5 -mr-0.5 cursor-col-resize hover:bg-black/25 active:bg-black/40 dark:hover:bg-white/25 dark:active:bg-white/40 transition-colors z-10 shrink-0"
              />
              <PropertiesInspector
                activeTab={inspectorTab}
                onTabChange={setInspectorTab}
                selectedElements={selectedElements}
                allElements={project.elements}
                pageConfig={project.pageConfig}
                fitConfig={fitConfig}
                originalPageMeta={currentMeta}
                activeSourceBox={currentLayout.sourceBox}
                cropMode={cropMode}
                redetectingBounds={redetectingBounds}
                currentPage={currentPage}
                dataColumnNames={project.dataColumns.map((c) => c.name)}
                customFonts={customFonts}
                savedTextStyles={savedTextStyles}
                savedPalettes={savedPalettes}
                panelWidthPx={inspectorWidthPx}
                onReorderElement={handleReorderElement}
                onUpdateElement={handleUpdateElement}
                onDeleteSelected={handleDeleteSelected}
                onDuplicateSelected={handleDuplicateSelected}
                onAlignSelected={handleAlignSelected}
                onDistributeSelected={handleDistributeSelected}
                onEqualSpaceSelected={handleEqualSpaceSelected}
                onBatchUpdateSelected={handleBatchUpdateSelected}
                onGroupToggle={handleGroupToggle}
                onSaveAsTextStyle={handleSaveAsTextStyle}
                onUpdatePageConfig={handleUpdatePageConfig}
                onUpdateFitConfig={handleUpdateFitConfig}
                onToggleCropMode={() => setCropMode((v) => !v)}
                onRedetectBounds={handleRedetectBounds}
                onApplyAiPlan={handleApplyAiPlan}
                aiSummary={project.aiSummary}
                aiEnhancing={aiEnhancing}
                aiEnhanceNotice={aiEnhanceNotice}
                onRunAiEnhancedAnalysis={() => void handleRunAiEnhancedAnalysis()}
                onOpenPageSetup={() => setShowPageSetupModal(true)}
                recentFonts={settings.recentFonts}
                favoriteFonts={settings.favoriteFonts}
                onToggleFavoriteFont={handleToggleFavoriteFont}
                onRecordRecentFont={handleRecordRecentFont}
                onCopyFormatting={handleCopyFormatting}
                onPasteFormatting={handlePasteFormatting}
                hasCopiedFormatting={Boolean(copiedFormatting)}
                onStartStylePainter={handleStartStylePainter}
                onOpenRedactionConfirm={() => setRedactionConfirmOpen(true)}
                onConvertSelectionToTable={handleConvertSelectionToTable}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile Adaptive GlassBottomSheet: Layers */}
        {viewport.isMobile && (
          <GlassBottomSheet
            isOpen={showLayersPanel}
            snapState={mobileSheetSnap}
            onSnapChange={setMobileSheetSnap}
            onClose={() => {
              setShowLayersPanel(false);
              setEditorMode('edit');
            }}
            title={`Layers · Page ${currentPage}`}
            subtitle={`${pageElements.length} elements`}
          >
            {renderLayersList(true, true)}
          </GlassBottomSheet>
        )}

        {/* Mobile Adaptive GlassBottomSheet: Properties, Page & AI */}
        {viewport.isMobile && (
          <GlassBottomSheet
            isOpen={showInspectorDrawer}
            snapState={mobileSheetSnap}
            onSnapChange={setMobileSheetSnap}
            onClose={() => {
              setShowInspectorDrawer(false);
              setEditorMode('edit');
            }}
            title={
              selectedElements.length > 0
                ? `${selectedElements.length} Selected · Properties`
                : 'Page, Crop & AI Assist'
            }
            subtitle="Swipe handle or tap arrow to resize"
          >
            <PropertiesInspector
              isDrawer
              hideDrawerHeader
              onCloseDrawer={() => {
                setShowInspectorDrawer(false);
                setEditorMode('edit');
              }}
              activeTab={inspectorTab}
              onTabChange={setInspectorTab}
              selectedElements={selectedElements}
              allElements={project.elements}
              pageConfig={project.pageConfig}
              fitConfig={fitConfig}
              originalPageMeta={currentMeta}
              activeSourceBox={currentLayout.sourceBox}
              cropMode={cropMode}
              redetectingBounds={redetectingBounds}
              currentPage={currentPage}
              dataColumnNames={project.dataColumns.map((c) => c.name)}
              customFonts={customFonts}
              savedTextStyles={savedTextStyles}
              savedPalettes={savedPalettes}
              onReorderElement={handleReorderElement}
              onUpdateElement={handleUpdateElement}
              onDeleteSelected={handleDeleteSelected}
              onDuplicateSelected={handleDuplicateSelected}
              onAlignSelected={handleAlignSelected}
              onDistributeSelected={handleDistributeSelected}
              onEqualSpaceSelected={handleEqualSpaceSelected}
              onBatchUpdateSelected={handleBatchUpdateSelected}
              onGroupToggle={handleGroupToggle}
              onSaveAsTextStyle={handleSaveAsTextStyle}
              onUpdatePageConfig={handleUpdatePageConfig}
              onUpdateFitConfig={handleUpdateFitConfig}
              onToggleCropMode={() => setCropMode((v) => !v)}
              onRedetectBounds={handleRedetectBounds}
              onApplyAiPlan={handleApplyAiPlan}
              aiSummary={project.aiSummary}
              aiEnhancing={aiEnhancing}
              aiEnhanceNotice={aiEnhanceNotice}
              onRunAiEnhancedAnalysis={() => void handleRunAiEnhancedAnalysis()}
              onOpenPageSetup={() => {
                setShowInspectorDrawer(false);
                setShowPageSetupModal(true);
              }}
              recentFonts={settings.recentFonts}
              favoriteFonts={settings.favoriteFonts}
              onToggleFavoriteFont={handleToggleFavoriteFont}
              onRecordRecentFont={handleRecordRecentFont}
              onCopyFormatting={handleCopyFormatting}
              onPasteFormatting={handlePasteFormatting}
              hasCopiedFormatting={Boolean(copiedFormatting)}
              onStartStylePainter={handleStartStylePainter}
              onOpenRedactionConfirm={() => {
                setShowInspectorDrawer(false);
                setRedactionConfirmOpen(true);
              }}
              onConvertSelectionToTable={() => {
                handleConvertSelectionToTable();
                setShowInspectorDrawer(false);
              }}
            />
          </GlassBottomSheet>
        )}

        {/* Mobile Adaptive GlassBottomSheet: Add Elements & Workstation 2.0 Tools */}
        {viewport.isMobile && (
          <GlassBottomSheet
            isOpen={mobileAddSheetOpen}
            snapState="medium"
            onClose={() => setMobileAddSheetOpen(false)}
            title="Insert & Studio 2.0 Tools"
            subtitle="Add elements, annotate, restore scans, or manage pages"
          >
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['Text', TypeIcon, () => addNewElement('text')],
                    ['Rectangle', Square, () => addNewElement('rect')],
                    ['Circle', Circle, () => addNewElement('circle')],
                    ['Line', Minus, () => addNewElement('line')],
                    ['Arrow', ArrowUpRight, () => setActiveTool('arrow')],
                    ['Table', Table2, () => addNewElement('table')],
                    ['QR Code', QrCode, () => addNewElement('qr_code')],
                    ['Barcode', ScanBarcode, () => addNewElement('barcode')],
                    ['Block', BoxSelect, handleCreateDocumentBlock],
                    ['Callout', MessageSquarePlus, () => setActiveTool('callout')],
                    ['Sticky Note', MessageSquare, () => setActiveTool('note')],
                  ] as const
                ).map(([label, Icon, action]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      handleSelectMode('edit');
                      action();
                      setMobileAddSheetOpen(false);
                    }}
                    className="min-h-[54px] p-2 rounded-2xl border glass-level-3 flex flex-col items-center justify-center gap-1 text-xs font-medium text-[#101010] dark:text-white"
                  >
                    <Icon className="w-4 h-4 text-[#101010] dark:text-white" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    imageUploadRef.current?.click();
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <ImageIcon className="w-4 h-4" />
                  Upload Image
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSignatureModalInitialTab('signature');
                    setSignatureStampOpen(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <PenTool className="w-4 h-4" />
                  Sign &amp; Stamp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('draw');
                    handleSelectMode('edit');
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <Pencil className="w-4 h-4" />
                  Freehand Pen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('highlight');
                    handleSelectMode('edit');
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <Highlighter className="w-4 h-4" />
                  Highlight
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('underline_annot');
                    handleSelectMode('edit');
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <Underline className="w-4 h-4" />
                  Underline Annot
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('strikeout_annot');
                    handleSelectMode('edit');
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <Strikethrough className="w-4 h-4" />
                  Strikeout Annot
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('measure');
                    handleSelectMode('edit');
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <Ruler className="w-4 h-4" />
                  Measure Caliper
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('redact');
                    handleSelectMode('edit');
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <ShieldAlert className="w-4 h-4" />
                  Mark Redaction
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSmartReplaceOpen(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <Replace className="w-4 h-4" />
                  Smart Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBatchStyleOpen(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <Wand2 className="w-4 h-4" />
                  Batch Style
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRestorationOpen(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <ScanLine className="w-4 h-4" />
                  Scan Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPageEngineeringOpen(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <FileCog className="w-4 h-4" />
                  Page Studio
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRedactionConfirmOpen(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Apply Redactions ({pendingRedactionCount})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowVersionModal(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <History className="w-4 h-4" />
                  History
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-black/10 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setShowRulers((v) => !v)}
                  className={`min-h-[38px] px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 ${
                    showRulers
                      ? 'studio-active-surface'
                      : 'glass-level-3 text-[#555555] dark:text-[#B5B5B5]'
                  }`}
                >
                  <Ruler className="w-3.5 h-3.5" />
                  Rulers
                </button>
                <button
                  type="button"
                  onClick={() => setShowGrid((v) => !v)}
                  className={`min-h-[38px] px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 ${
                    showGrid
                      ? 'studio-active-surface'
                      : 'glass-level-3 text-[#555555] dark:text-[#B5B5B5]'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  Grid
                </button>
                <button
                  type="button"
                  onClick={handleToggleSnapAndGuides}
                  className={`min-h-[38px] px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 ${
                    snapToGrid && showGuides
                      ? 'studio-active-surface'
                      : 'glass-level-3 text-[#555555] dark:text-[#B5B5B5]'
                  }`}
                >
                  <Magnet className="w-3.5 h-3.5" />
                  Snap
                </button>
              </div>
            </div>
          </GlassBottomSheet>
        )}

        {/* Tablet Slide-Out Layers, Pages & Inspector Drawers */}
        <AnimatePresence>
          {viewport.isTablet && showLayersPanel && (
            <motion.div
              key="tablet-layers-backdrop"
              variants={modalBackdropVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="fixed inset-0 z-40 bg-black/45 flex"
              onClick={() => setShowLayersPanel(false)}
            >
              <motion.div
                key="tablet-layers-panel"
                variants={drawerLeftVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onClick={(e) => e.stopPropagation()}
                className="w-[85vw] max-w-xs h-full glass-level-4 border-r"
              >
                {renderLayersList(true)}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {viewport.isTablet && showPagesDrawer && (
            <motion.div
              key="tablet-pages-backdrop"
              variants={modalBackdropVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="fixed inset-0 z-40 bg-black/45 flex"
              onClick={() => setShowPagesDrawer(false)}
            >
              <motion.div
                key="tablet-pages-panel"
                variants={drawerLeftVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onClick={(e) => e.stopPropagation()}
                className="w-[85vw] max-w-xs h-full glass-level-4 border-r"
              >
                {renderPagesDrawerContent()}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {viewport.isTablet && showInspectorDrawer && (
            <motion.div
              key="tablet-inspector-backdrop"
              variants={modalBackdropVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="fixed inset-0 z-40 bg-black/45 flex justify-end"
              onClick={() => setShowInspectorDrawer(false)}
            >
              <motion.div
                key="tablet-inspector-panel"
                variants={drawerRightVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onClick={(e) => e.stopPropagation()}
                className="w-full tablet:w-96 max-w-md h-full glass-level-4 border-l"
              >
                <PropertiesInspector
                  isDrawer
                  onCloseDrawer={() => setShowInspectorDrawer(false)}
                  activeTab={inspectorTab}
                  onTabChange={setInspectorTab}
                  selectedElements={selectedElements}
                  allElements={project.elements}
                  pageConfig={project.pageConfig}
                  fitConfig={fitConfig}
                  originalPageMeta={currentMeta}
                  activeSourceBox={currentLayout.sourceBox}
                  cropMode={cropMode}
                  redetectingBounds={redetectingBounds}
                  currentPage={currentPage}
                  dataColumnNames={project.dataColumns.map((c) => c.name)}
                  customFonts={customFonts}
                  savedTextStyles={savedTextStyles}
                  savedPalettes={savedPalettes}
                  onReorderElement={handleReorderElement}
                  onUpdateElement={handleUpdateElement}
                  onDeleteSelected={handleDeleteSelected}
                  onDuplicateSelected={handleDuplicateSelected}
                  onAlignSelected={handleAlignSelected}
                  onDistributeSelected={handleDistributeSelected}
                  onEqualSpaceSelected={handleEqualSpaceSelected}
                  onBatchUpdateSelected={handleBatchUpdateSelected}
                  onGroupToggle={handleGroupToggle}
                  onSaveAsTextStyle={handleSaveAsTextStyle}
                  onUpdatePageConfig={handleUpdatePageConfig}
                  onUpdateFitConfig={handleUpdateFitConfig}
                  onToggleCropMode={() => setCropMode((v) => !v)}
                  onRedetectBounds={handleRedetectBounds}
                  onApplyAiPlan={handleApplyAiPlan}
                  aiSummary={project.aiSummary}
                  aiEnhancing={aiEnhancing}
                  aiEnhanceNotice={aiEnhanceNotice}
                  onRunAiEnhancedAnalysis={() => void handleRunAiEnhancedAnalysis()}
                  onOpenPageSetup={() => {
                    setShowInspectorDrawer(false);
                    setShowPageSetupModal(true);
                  }}
                  recentFonts={settings.recentFonts}
                  favoriteFonts={settings.favoriteFonts}
                  onToggleFavoriteFont={handleToggleFavoriteFont}
                  onRecordRecentFont={handleRecordRecentFont}
                  onCopyFormatting={handleCopyFormatting}
                  onPasteFormatting={handlePasteFormatting}
                  hasCopiedFormatting={Boolean(copiedFormatting)}
                  onStartStylePainter={handleStartStylePainter}
                  onOpenRedactionConfirm={() => {
                    setShowInspectorDrawer(false);
                    setRedactionConfirmOpen(true);
                  }}
                  onConvertSelectionToTable={() => {
                    handleConvertSelectionToTable();
                    setShowInspectorDrawer(false);
                  }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Compact Floating-Glass Bottom Editor Dock */}
      {viewport.isMobile && (
        <div className="glass-level-2 border-t shrink-0 pb-safe z-30">
          <div className="grid grid-cols-5 px-1 h-14 items-center">
            <button
              type="button"
              onClick={() =>
                handleSelectMode(editorMode === 'preview' ? 'edit' : 'preview')
              }
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                editorMode === 'preview'
                  ? 'text-[#101010] dark:text-white font-semibold'
                  : 'text-[#888888] dark:text-[#858585] font-medium'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>{editorMode === 'preview' ? 'Preview' : 'Edit'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectMode('layers')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                showLayersPanel
                  ? 'text-[#101010] dark:text-white font-semibold'
                  : 'text-[#888888] dark:text-[#858585] font-medium'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Layers</span>
            </button>

            <div className="flex items-center justify-center">
              <motion.button
                type="button"
                whileTap={!prefersReduced ? FAB_TAP : undefined}
                transition={MOTION_SPRING.snappy}
                onClick={() => setMobileAddSheetOpen(true)}
                aria-label="Add element or tool"
                className="min-w-[48px] min-h-[40px] px-3 rounded-2xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] border border-black/15 dark:border-white/25 shadow-md flex items-center justify-center touch-manipulation"
              >
                <Plus className="w-5 h-5" />
              </motion.button>
            </div>

            <button
              type="button"
              onClick={() => handleSelectMode('properties')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] ${
                showInspectorDrawer
                  ? 'text-[#101010] dark:text-white font-semibold'
                  : 'text-[#888888] dark:text-[#858585] font-medium'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Props</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectMode('pages')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] ${
                showMobileThumbStrip
                  ? 'text-[#101010] dark:text-white font-semibold'
                  : 'text-[#888888] dark:text-[#858585] font-medium'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Pages</span>
            </button>
          </div>
        </div>
      )}

      <PageConfigurationModal
        isOpen={showPageSetupModal}
        project={project}
        onClose={() => setShowPageSetupModal(false)}
        onApplyConfig={(
          nextPageConfig,
          nextSpacing,
          nextCopiesPatch,
          nextFitPatch
        ) => {
          commitProjectChange(
            {
              ...project,
              pageConfig: nextPageConfig,
              fitConfig: nextFitPatch
                ? { ...fitConfig, ...nextFitPatch }
                : project.fitConfig,
              exportConfig: {
                ...project.exportConfig,
                bleedPt: nextPageConfig.bleedPt ?? project.exportConfig.bleedPt,
                cropMarks: nextPageConfig.cropMarks ?? project.exportConfig.cropMarks,
                customWidthPt: undefined,
                customHeightPt: undefined,
              },
              copiesConfig: {
                ...project.copiesConfig,
                ...(nextCopiesPatch || {}),
                ...(nextSpacing
                  ? {
                      horizontalSpacingPt: nextSpacing.horizontalSpacingPt,
                      verticalSpacingPt: nextSpacing.verticalSpacingPt,
                    }
                  : {}),
              },
            },
            'Page Configuration',
            'page_config',
            'Page Setup',
            `${nextPageConfig.sizePreset} (${Math.round(nextPageConfig.widthPt)}×${Math.round(nextPageConfig.heightPt)}pt)`
          );
        }}
      />

      <VersionHistoryModal
        isOpen={showVersionModal}
        project={project}
        onClose={() => setShowVersionModal(false)}
        onSaveNamedVersion={(note) => {
          void handleSaveNow(note);
        }}
        historyEntries={undoStack}
        onRevertHistoryEntry={handleRevertToHistoryEntry}
        onRevertIndividualOperation={handleRevertIndividualOperation}
        onRestoreVersion={(snap) => {
          if (onRestoreVersion) {
            onRestoreVersion(snap);
          } else {
            onUpdateProject(
              appendOperationLog(
                {
                  ...project,
                  elements: structuredClone(snap.elementsSnapshot),
                  pageConfig: structuredClone(snap.pageConfigSnapshot),
                  fitConfig: snap.fitConfigSnapshot
                    ? structuredClone(snap.fitConfigSnapshot)
                    : project.fitConfig,
                  copiesConfig: snap.copiesConfigSnapshot
                    ? structuredClone(snap.copiesConfigSnapshot)
                    : project.copiesConfig,
                  version: project.version + 1,
                  updatedAt: new Date().toISOString(),
                },
                'Restore Version',
                `Restored snapshot v${snap.version} (${snap.note})`
              )
            );
          }
          setShowVersionModal(false);
        }}
      />

      <SmartReplaceModal
        isOpen={smartReplaceOpen}
        onClose={() => setSmartReplaceOpen(false)}
        elements={project.elements}
        currentPage={currentPage}
        onApplyReplace={(updates, summary) => {
          const map = new Map(updates.map((u) => [u.id, u.patch]));
          commitElements(
            project.elements.map((el) =>
              map.has(el.id) ? { ...el, ...map.get(el.id)! } : el
            ),
            true,
            'Smart Replace',
            summary
          );
          showNoticeToast(summary);
        }}
      />

      <BatchStyleModal
        isOpen={batchStyleOpen}
        onClose={() => setBatchStyleOpen(false)}
        project={project}
        currentPage={currentPage}
        customFonts={customFonts}
        onApplyBatchStyle={(updates, summary) => {
          const map = new Map(updates.map((u) => [u.id, u.patch]));
          commitElements(
            project.elements.map((el) =>
              map.has(el.id) ? { ...el, ...map.get(el.id)! } : el
            ),
            true,
            'Batch Style',
            summary
          );
          showNoticeToast(summary);
        }}
      />

      <RestorationStudioModal
        isOpen={restorationOpen}
        onClose={() => setRestorationOpen(false)}
        project={project}
        currentPage={currentPage}
        sourceImageUrl={pageBgUrl}
        ocrLanguage={settings.ocrLanguage}
        onApplyPageRestoration={(
          pageNumbers,
          restorationConfig: PageRestorationConfig,
          previewsByPage
        ) => {
          const targetSet = new Set(pageNumbers);
          const nextPages = project.originalPages.map((pg) => {
            if (!targetSet.has(pg.pageNumber)) return pg;
            return {
              ...pg,
              restoration: restorationConfig.enabled ? restorationConfig : undefined,
              restoredPreviewDataUrl: restorationConfig.enabled
                ? previewsByPage[pg.pageNumber] || pg.restoredPreviewDataUrl
                : undefined,
            };
          });
          commitProjectChange(
            { ...project, originalPages: nextPages },
            restorationConfig.enabled
              ? `Restore Scan (${pageNumbers.length} page)`
              : `Revert Scan Restoration`,
            'restoration',
            'Scan Restoration',
            restorationConfig.enabled
              ? `Restored ${pageNumbers.length} page(s)`
              : 'Reverted page restoration'
          );
          showNoticeToast(
            restorationConfig.enabled
              ? `Restored ${pageNumbers.length} page(s)`
              : 'Reverted to original scan'
          );
        }}
        onAppendOcrElements={(newEls) => {
          commitElements(
            [...project.elements, ...newEls],
            true,
            'Local Scan OCR',
            `Extracted ${newEls.length} text block(s) on Page ${currentPage}`
          );
        }}
      />

      <PageEngineeringModal
        isOpen={pageEngineeringOpen}
        onClose={() => setPageEngineeringOpen(false)}
        project={project}
        currentPage={currentPage}
        onApplyPageStructure={(nextProject, nextCurrentPage, label) => {
          commitProjectChange(
            nextProject,
            label,
            'page_structure',
            'Page Engineering',
            label
          );
          setCurrentPage(nextCurrentPage);
          setSelectedIds([]);
        }}
      />

      <SignatureStampModal
        isOpen={signatureStampOpen}
        onClose={() => setSignatureStampOpen(false)}
        currentPage={currentPage}
        initialTab={signatureModalInitialTab}
        onInsertElement={(el, label) => {
          commitElements([...project.elements, el], true, label, label);
          setSelectedIds([el.id]);
          setInspectorTab('element');
        }}
        onSaveSignatureToLibrary={
          onSaveAsset
            ? (name, dataUrl, naturalWidth, naturalHeight) => {
                onSaveAsset({
                  id: `sig-asset-${Date.now()}`,
                  kind: 'logo',
                  name,
                  dataUrl,
                  naturalWidth,
                  naturalHeight,
                  createdAt: new Date().toISOString(),
                });
              }
            : undefined
        }
      />

      <RedactionConfirmModal
        isOpen={redactionConfirmOpen}
        onClose={() => setRedactionConfirmOpen(false)}
        project={project}
        customFonts={customFonts}
        onApplyRedactions={(updatedProject, summary) => {
          commitProjectChange(
            updatedProject,
            'Apply True Redaction',
            'redaction',
            'True Redaction',
            summary
          );
          setSelectedIds([]);
          showNoticeToast(summary);
        }}
      />
    </div>
  );
};
