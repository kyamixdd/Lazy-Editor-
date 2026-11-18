import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
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
  FolderPlus,
  GitCompare,
  Grid,
  Group,
  History,
  Image as ImageIcon,
  Layers,
  Lock,
  Magnet,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  PanelRight,
  Plus,
  Redo2,
  Ruler,
  Save,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Ungroup,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AiEditPlan,
  AssetFontItem,
  AssetImageItem,
  AssetLibraryItem,
  AssetPaletteItem,
  AssetShapeItem,
  AssetTextStyleItem,
  DocumentElement,
  NavSection,
  PageConfig,
  PDFProject,
  ProjectVersionSnapshot,
  RectPt,
  SourceFitConfig,
  StudioSettings,
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
import { appendOperationLog, DEFAULT_SHORTCUTS } from '../utils/projectStorage';
import { GlassBottomSheet, SheetSnapState } from './glass';
import { PageConfigurationModal } from './PageConfigurationModal';
import { PdfCanvasStage } from './PdfCanvasStage';
import { PropertiesInspector } from './PropertiesInspector';
import { VersionHistoryModal } from './VersionHistoryModal';

interface EditorViewProps {
  project: PDFProject;
  settings: StudioSettings;
  assets?: AssetLibraryItem[];
  focusTarget?: { pageNumber: number; elementId?: string; nonce: number } | null;
  onUpdateProject: (updated: PDFProject) => void;
  onUpdateSettings?: (next: StudioSettings) => void;
  onSaveSnapshot: (project: PDFProject, note: string) => void;
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
    settings.workspaceLayout !== 'wide-canvas'
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
  const [undoStack, setUndoStack] = useState<DocumentElement[][]>([]);
  const [redoStack, setRedoStack] = useState<DocumentElement[][]>([]);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [pageBgUrl, setPageBgUrl] = useState<string | undefined>(
    project.originalPages[0]?.previewImageDataUrl
  );
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const lastAutoSnapHashRef = useRef<string>(JSON.stringify(project.elements));

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

  // Clamp currentPage when switching projects
  useEffect(() => {
    setCurrentPage((p) => Math.max(1, Math.min(p, Math.max(1, project.pageCount))));
    lastAutoSnapHashRef.current = JSON.stringify(project.elements);
  }, [project.id, project.pageCount]);

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

  // Autosave recoverable unsaved draft snapshot (debounced)
  useEffect(() => {
    if (!onSaveUnsavedDraft) return;
    const timer = window.setTimeout(() => {
      onSaveUnsavedDraft({
        projectId: project.id,
        projectName: project.name,
        savedAt: new Date().toISOString(),
        projectSnapshot: project,
        dirty: true,
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [project.elements, project.pageConfig, project.id]);

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
        if (thumbnails[p]) continue;
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
    editorMode,
    viewport.isMobile,
    project.id,
    project.pageCount,
    project.originalPages,
    project.sourcePdfBase64,
    thumbnails,
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

  const commitElements = (
    nextElements: DocumentElement[],
    recordHistory = true,
    opAction?: string,
    opDetail?: string
  ) => {
    if (recordHistory) {
      setUndoStack((prev) => [...prev.slice(-40), project.elements]);
      setRedoStack([]);
    }
    const baseUpdated: PDFProject = {
      ...project,
      elements: nextElements,
      updatedAt: new Date().toISOString(),
    };
    onUpdateProject(
      opAction
        ? appendOperationLog(
            baseUpdated,
            opAction,
            opDetail || opAction,
            currentPage
          )
        : baseUpdated
    );
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, project.elements]);
    setUndoStack((u) => u.slice(0, -1));
    onUpdateProject({
      ...project,
      elements: prev,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, project.elements]);
    setRedoStack((r) => r.slice(0, -1));
    onUpdateProject({
      ...project,
      elements: next,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateElement = (id: string, patch: Partial<DocumentElement>) => {
    commitElements(
      project.elements.map((el) => (el.id === id ? { ...el, ...patch } : el))
    );
  };

  const handleUpdateElementsBatch = (
    updates: Array<{ id: string; patch: Partial<DocumentElement> }>
  ) => {
    const map = new Map(updates.map((u) => [u.id, u.patch]));
    commitElements(
      project.elements.map((el) =>
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
    setStyleToast(`Saved text style "${item.name}" to Asset Library`);
    window.setTimeout(() => setStyleToast(null), 2600);
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

  const addNewElement = (
    kind: 'text' | 'rect' | 'circle' | 'line' | 'border' | 'table'
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
          : 'shape',
      pageNumber: currentPage,
      x: 72,
      y: 90,
      width: kind === 'table' ? 320 : kind === 'line' ? 220 : 150,
      height: kind === 'table' ? 96 : kind === 'line' ? 12 : kind === 'text' ? 28 : 80,
      rotation: 0,
      text: kind === 'text' ? 'New Text Block' : '',
      fontFamily: 'Helvetica',
      fontSize: 12,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#111827',
      backgroundColor: 'transparent',
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

    onUpdateProject({
      ...project,
      pageCount: project.pageCount + 1,
      originalPages: nextOriginalPages,
      elements: [...shiftedElements, ...clonedPageElements],
      updatedAt: new Date().toISOString(),
    });
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
        color: '#2563EB',
        backgroundColor: 'transparent',
        borderColor: '#2563EB',
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
        color: '#2563EB',
        backgroundColor: 'transparent',
        borderColor: '#2563EB',
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
        const ratio = canvas.height / Math.max(1, canvas.width);
        const wPt = Math.min(180, Math.max(60, canvas.width * 0.5));
        const hPt = Math.max(24, wPt * ratio);

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
          imageNaturalWidth: canvas.width,
          imageNaturalHeight: canvas.height,
        };
        commitElements(
          [...project.elements, el],
          true,
          'Insert Image',
          `Uploaded image "${file.name}" (${canvas.width}×${canvas.height}px)`
        );
        setSelectedIds([id]);
        onTrackRecentTool?.('image');
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
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
        next = next.filter((el) => el.id !== op.targetId);
      } else if (op.action === 'duplicate' && op.targetId) {
        const src = next.find((el) => el.id === op.targetId);
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
    onUpdateProject({
      ...project,
      pageConfig: nextPageConfig,
      exportConfig: {
        ...project.exportConfig,
        ...(patch.bleedPt !== undefined ? { bleedPt: patch.bleedPt } : {}),
        ...(patch.cropMarks !== undefined ? { cropMarks: patch.cropMarks } : {}),
        customWidthPt: undefined,
        customHeightPt: undefined,
      },
      updatedAt: new Date().toISOString(),
    });
  };

  const fitConfig = normalizeFitConfig(project);
  const currentMeta =
    project.originalPages.find((p) => p.pageNumber === currentPage) ||
    project.originalPages[0];
  const currentLayout = computeSheetLayout(project, currentPage);

  const handleUpdateFitConfig = (patch: Partial<SourceFitConfig>) => {
    onUpdateProject({
      ...project,
      fitConfig: { ...fitConfig, ...patch },
      updatedAt: new Date().toISOString(),
    });
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

    setUndoStack((prev) => [...prev.slice(-40), project.elements]);
    setRedoStack([]);
    onUpdateProject(result.updatedProject);
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
      } else if (matchesShortcutCombo(e, shortcuts.saveSnapshot)) {
        e.preventDefault();
        onSaveSnapshot(projectRef.current, `Snapshot via shortcut (Page ${currentPage})`);
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

  const stageInteractionMode: 'preview' | 'edit' =
    editorMode === 'preview' ? 'preview' : 'edit';

  const handleSelectMode = (mode: EditorMode) => {
    setEditorMode(mode);
    if (viewport.isMobile) {
      setShowLayersPanel(mode === 'layers');
      setShowInspectorDrawer(mode === 'properties');
      setShowPagesDrawer(mode === 'pages');
      if (mode === 'layers' || mode === 'properties') {
        setMobileSheetSnap('medium');
        setMobileAddSheetOpen(false);
      }
      if (mode === 'pages') {
        setShowMobileThumbStrip((v) => !v);
      }
    } else if (viewport.isTablet) {
      if (mode === 'layers') {
        setShowLayersPanel(true);
        setShowPagesDrawer(false);
      } else if (mode === 'properties') {
        setShowInspectorDrawer(true);
      } else if (mode === 'pages') {
        setShowPagesDrawer(true);
      }
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
        <div className="px-3 py-2.5 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 shrink-0">
          <span>Layers (Page {currentPage})</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-normal text-slate-500 tabular-nums">
              {pageElements.length}
            </span>
            {!viewport.isDesktop && (
              <button
                type="button"
                onClick={() => {
                  setShowLayersPanel(false);
                  if (viewport.isMobile) setEditorMode('edit');
                }}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
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

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 pb-safe">
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
                  ? 'bg-blue-600/12 text-blue-700 dark:text-blue-400'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{el.text || el.type}</div>
                <div className="text-[10px] text-slate-400 truncate">
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
                  } flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-slate-100`}
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
                  } flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-slate-100`}
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
                  } flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-slate-100`}
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
                  } flex items-center justify-center text-slate-400 hover:text-slate-900 dark:hover:text-slate-100`}
                >
                  {el.locked ? (
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
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
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 shrink-0">
        <span>Pages ({project.pageCount})</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleDuplicatePage}
            className="min-h-[36px] px-2.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium flex items-center gap-1"
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
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
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
              className={`p-2 rounded-lg border text-left transition-colors ${
                isActive
                  ? 'border-blue-600 bg-blue-600/10'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="aspect-[3/4] w-full rounded border border-slate-200 dark:border-slate-700 bg-white overflow-hidden flex items-center justify-center">
                {thumb ? (
                  <img
                    src={thumb}
                    alt={`Page ${pageNum}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-[11px] font-mono text-slate-400">
                    P{pageNum}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                  Page {pageNum}
                </span>
                <span className="text-slate-400 tabular-nums">{elCount} el</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => {
            setShowPagesDrawer(false);
            setShowPageSetupModal(true);
          }}
          className="w-full min-h-[44px] rounded-md border border-blue-600/40 bg-blue-600/10 text-blue-600 dark:text-blue-400 font-medium text-xs flex items-center justify-center gap-1.5"
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
      {/* Desktop & Tablet Liquid Glass Top Toolbar */}
      {!viewport.isMobile && (
        <header className="h-12 px-3 border-b glass-level-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar shrink-0 z-20">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              title="Toggle Layers"
              onClick={() => setShowLayersPanel((v) => !v)}
              className={`p-1.5 rounded-lg transition-colors ${
                showLayersPanel
                  ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
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
                  ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
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
                    ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
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
                    ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10'
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
                    ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
                }`}
              >
                {isWorkspaceMaximized ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            )}

            <div className="h-4 w-px bg-slate-300/60 dark:bg-white/10 mx-1" />

            <button
              type="button"
              title="Undo"
              disabled={undoStack.length === 0}
              onClick={handleUndo}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Redo"
              disabled={redoStack.length === 0}
              onClick={handleRedo}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              <Redo2 className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-300/60 dark:bg-white/10 mx-1" />

            {!isToolHidden('text') && (
              <button
                type="button"
                title="Add Text"
                onClick={() => addNewElement('text')}
                className="px-2 py-1 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center gap-1 whitespace-nowrap"
              >
                <TypeIcon className="w-3.5 h-3.5" />
                Text
              </button>
            )}
            {!isToolHidden('rect') && (
              <button
                type="button"
                title="Add Rectangle"
                onClick={() => addNewElement('rect')}
                className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('circle') && (
              <button
                type="button"
                title="Add Circle"
                onClick={() => addNewElement('circle')}
                className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10"
              >
                <Circle className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('line') && (
              <button
                type="button"
                title="Add Line"
                onClick={() => addNewElement('line')}
                className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('table') && (
              <button
                type="button"
                title="Add Table"
                onClick={() => addNewElement('table')}
                className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10"
              >
                <Table2 className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('block') && (
              <button
                type="button"
                title="Create Document Block (from selection or new frame)"
                onClick={handleCreateDocumentBlock}
                className="px-2 py-1 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center gap-1 whitespace-nowrap"
              >
                <BoxSelect className="w-3.5 h-3.5" />
                Block
              </button>
            )}
            {!isToolHidden('image') && (
              <button
                type="button"
                title="Add Image / Logo"
                onClick={() => imageUploadRef.current?.click()}
                className="p-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('assets') && (
              <div className="relative">
                <button
                  type="button"
                  title="Insert Saved Asset from Library"
                  onClick={() => setShowAssetInsertMenu((v) => !v)}
                  className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 whitespace-nowrap ${
                    showAssetInsertMenu
                      ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10'
                  }`}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  Assets
                </button>
                {showAssetInsertMenu && (
                  <div className="absolute left-0 top-full mt-1.5 w-64 rounded-2xl border glass-level-4 z-50 p-2.5 text-xs space-y-2 max-h-80 overflow-y-auto">
                    <div className="font-semibold text-slate-700 dark:text-slate-200 px-1">
                      Saved Logos & Images ({savedImages.length})
                    </div>
                    {savedImages.length === 0 ? (
                      <div className="px-1 text-[11px] text-slate-400">
                        None saved. Upload in Asset Library.
                      </div>
                    ) : (
                      savedImages.map((img) => (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => handleInsertAssetImage(img)}
                          className="w-full px-2 py-1.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center gap-2 text-left"
                        >
                          <img
                            src={img.dataUrl}
                            alt={img.name}
                            className="w-6 h-6 object-contain bg-white rounded border border-slate-200"
                          />
                          <span className="truncate flex-1">{img.name}</span>
                        </button>
                      ))
                    )}
                    <div className="font-semibold text-slate-700 dark:text-slate-200 px-1 pt-1 border-t border-slate-200/70 dark:border-white/10">
                      Saved Shapes ({savedShapes.length})
                    </div>
                    {savedShapes.length === 0 ? (
                      <div className="px-1 text-[11px] text-slate-400">
                        None saved. Create in Asset Library.
                      </div>
                    ) : (
                      savedShapes.map((shp) => (
                        <button
                          key={shp.id}
                          type="button"
                          onClick={() => handleInsertAssetShape(shp)}
                          className="w-full px-2 py-1.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center justify-between text-left"
                        >
                          <span className="truncate">{shp.name}</span>
                          <span className="text-[10px] text-slate-400">{shp.shapeKind}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="h-4 w-px bg-slate-300/60 dark:bg-white/10 mx-1" />

            <button
              type="button"
              title="Copy selected"
              disabled={selectedIds.length === 0}
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Paste"
              disabled={clipboard.length === 0}
              onClick={handlePaste}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title={`Duplicate with offset (+${settings.duplicateOffsetXPt ?? 14}, +${settings.duplicateOffsetYPt ?? 14}pt)`}
              disabled={selectedIds.length === 0}
              onClick={handleDuplicateSelected}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              <CopyPlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Group / Ungroup"
              disabled={selectedIds.length === 0}
              onClick={handleGroupToggle}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              {selectedElements[0]?.groupId ? (
                <Ungroup className="w-3.5 h-3.5" />
              ) : (
                <Group className="w-3.5 h-3.5" />
              )}
            </button>
            {!isToolHidden('search') && (
              <button
                type="button"
                title="Search & Replace"
                onClick={() => {
                  setShowSearchBar((v) => !v);
                  onTrackRecentTool?.('search');
                }}
                className={`p-1.5 rounded-lg ${
                  showSearchBar
                    ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            )}
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
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              {editorMode === 'preview' ? 'Preview' : 'Edit'}
            </button>
            {!isToolHidden('rulers') && (
              <button
                type="button"
                title="Rulers"
                onClick={() => setShowRulers((v) => !v)}
                className={`p-1.5 rounded-lg ${
                  showRulers
                    ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                    : 'text-slate-500 hover:bg-slate-200/60 dark:hover:bg-white/10'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('grid') && (
              <button
                type="button"
                title="Grid"
                onClick={() => setShowGrid((v) => !v)}
                className={`p-1.5 rounded-lg ${
                  showGrid
                    ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                    : 'text-slate-500 hover:bg-slate-200/60 dark:hover:bg-white/10'
                }`}
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('snap') && (
              <button
                type="button"
                title="Snap to Grid & Alignment Guides"
                onClick={() => {
                  setSnapToGrid((v) => !v);
                  setShowGuides((v) => !v);
                }}
                className={`p-1.5 rounded-lg ${
                  snapToGrid
                    ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                    : 'text-slate-500 hover:bg-slate-200/60 dark:hover:bg-white/10'
                }`}
              >
                <Magnet className="w-3.5 h-3.5" />
              </button>
            )}
            {!isToolHidden('crop') && (
              <button
                type="button"
                title="Visual Crop & Content Boundary Handles"
                onClick={() => {
                  setCropMode((v) => {
                    const next = !v;
                    if (next) setInspectorTab('page');
                    return next;
                  });
                  onTrackRecentTool?.('crop');
                }}
                className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 whitespace-nowrap ${
                  cropMode
                    ? 'bg-emerald-500/18 text-emerald-600 dark:text-emerald-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10'
                }`}
              >
                <Crop className="w-3.5 h-3.5" />
                Crop
              </button>
            )}
            <button
              type="button"
              title="Custom Paper Size, Units, Margins & Presets"
              onClick={() => setShowPageSetupModal(true)}
              className="px-2 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center gap-1 whitespace-nowrap"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {project.pageConfig.customPresetName || project.pageConfig.sizePreset}
            </button>

            <div className="h-4 w-px bg-slate-300/60 dark:bg-white/10 mx-1" />

            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.max(0.3, Number((z - 0.15).toFixed(2))))
              }
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono tabular-nums w-11 text-center text-slate-700 dark:text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))
              }
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-slate-300/60 dark:bg-white/10 mx-1" />

            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
              {currentPage} / {project.pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= project.pageCount}
              onClick={() =>
                setCurrentPage((p) => Math.min(project.pageCount, p + 1))
              }
              className="p-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 disabled:opacity-35"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {!isToolHidden('dupPage') && (
              <button
                type="button"
                title="Duplicate Entire PDF Page"
                onClick={handleDuplicatePage}
                className="px-2 py-1 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center gap-1 whitespace-nowrap"
              >
                <CopyPlus className="w-3.5 h-3.5" />
                Dup Page
              </button>
            )}

            {!isToolHidden('history') && (
              <button
                type="button"
                title="Version History & Operation Log"
                onClick={() => setShowVersionModal(true)}
                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10"
              >
                <History className="w-3.5 h-3.5" />
              </button>
            )}

            {!isToolHidden('qc') && onNavigateSection && (
              <>
                <button
                  type="button"
                  title="Run Preflight Quality Inspection"
                  onClick={() => onNavigateSection('preflight')}
                  className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Compare Original vs Edited PDF"
                  onClick={() => onNavigateSection('compare')}
                  className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10"
                >
                  <GitCompare className="w-3.5 h-3.5" />
                </button>
              </>
            )}

            <button
              type="button"
              title="Open AI-Enhanced Analysis & AI Editing Assistant (Optional)"
              onClick={() => {
                setInspectorTab('ai');
                setShowDesktopInspector(true);
              }}
              className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 whitespace-nowrap ${
                inspectorTab === 'ai'
                  ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI Assist
            </button>

            <button
              type="button"
              onClick={() =>
                onSaveSnapshot(project, `Manual snapshot (Page ${currentPage})`)
              }
              className="ml-1 px-3 py-1.5 rounded-xl text-xs font-medium bg-gradient-to-b from-blue-500 to-blue-600 text-white border border-blue-400/50 shadow-sm hover:from-blue-500 hover:to-blue-700 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </header>
      )}

      <input
        ref={imageUploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleImageUpload(e.target.files?.[0])}
      />

      {/* Search & Replace Bar */}
      {showSearchBar && (
        <div className="px-3 tablet:px-4 py-2 border-b glass-level-2 flex flex-wrap items-center gap-2 text-xs shrink-0 z-20">
          <input
            type="text"
            placeholder="Find text..."
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            className="flex-1 min-w-[120px] min-h-[38px] tablet:min-h-0 px-2.5 py-1 rounded-xl border border-slate-300/70 dark:border-white/15 bg-white/75 dark:bg-slate-900/70"
          />
          <input
            type="text"
            placeholder="Replace with..."
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            className="flex-1 min-w-[120px] min-h-[38px] tablet:min-h-0 px-2.5 py-1 rounded-xl border border-slate-300/70 dark:border-white/15 bg-white/75 dark:bg-slate-900/70"
          />
          <button
            type="button"
            onClick={handleSearchAndReplace}
            className="min-h-[38px] tablet:min-h-0 px-3 py-1 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            Replace All
          </button>
          <button
            type="button"
            onClick={() => setShowSearchBar(false)}
            className="min-h-[38px] tablet:min-h-0 px-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            Close
          </button>
        </div>
      )}

      {/* Desktop Recent Tools Strip & Style Feedback */}
      {!viewport.isMobile &&
        ((settings.recentTools && settings.recentTools.length > 0 && !isToolHidden('recentBar')) ||
          styleToast) && (
          <div className="px-3 py-1 border-b border-slate-200/70 dark:border-white/8 glass-level-1 flex items-center justify-between gap-2 text-[11px] shrink-0 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-slate-400">Recent:</span>
              {(settings.recentTools || []).slice(0, 6).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (t === 'text' || t === 'rect' || t === 'circle' || t === 'line' || t === 'table') {
                      addNewElement(t);
                    } else if (t === 'image') {
                      imageUploadRef.current?.click();
                    } else if (t === 'duplicate') {
                      handleDuplicateSelected();
                    } else if (t === 'crop') {
                      setCropMode((v) => !v);
                    } else if (t === 'search') {
                      setShowSearchBar((v) => !v);
                    } else if (t.startsWith('align_')) {
                      handleAlignSelected(t.replace('align_', '') as AlignMode);
                    }
                  }}
                  className="px-2 py-0.5 rounded-lg border border-slate-200/70 dark:border-white/10 glass-level-3 text-slate-600 dark:text-slate-300 hover:border-blue-500/50 capitalize"
                >
                  {t.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            {styleToast && (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {styleToast}
              </span>
            )}
          </div>
        )}

      {/* Main Workspace Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop Resizable Left Layers Panel */}
        {viewport.isDesktop && showLayersPanel && (
          <div className="relative shrink-0 flex">
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
              className="w-1.5 -ml-0.5 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors z-10 shrink-0"
            />
          </div>
        )}

        {/* Desktop Pages Strip Drawer */}
        {viewport.isDesktop && showPagesDrawer && (
          <aside className="w-52 shrink-0 border-r glass-level-2 flex flex-col overflow-hidden">
            {renderPagesDrawerContent()}
          </aside>
        )}

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
                      className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200"
                    >
                      <Menu className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={undoStack.length === 0}
                    onClick={handleUndo}
                    aria-label="Undo"
                    className="min-w-[34px] min-h-[38px] flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 disabled:opacity-30"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={redoStack.length === 0}
                    onClick={handleRedo}
                    aria-label="Redo"
                    className="min-w-[34px] min-h-[38px] flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 disabled:opacity-30"
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
                    className="min-w-[30px] min-h-[36px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMobileThumbStrip((v) => !v)}
                    className={`px-2.5 min-h-[34px] rounded-xl text-[11px] font-mono font-medium tabular-nums border ${
                      showMobileThumbStrip
                        ? 'border-blue-500/50 bg-blue-500/15 text-blue-600 dark:text-blue-300'
                        : 'border-slate-200/70 dark:border-white/10 text-slate-800 dark:text-slate-100'
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
                    className="min-w-[30px] min-h-[36px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowPageSetupModal(true)}
                    aria-label="Page settings"
                    className="min-w-[36px] min-h-[38px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSaveSnapshot(project, `Manual snapshot (Page ${currentPage})`)
                    }
                    className="min-h-[36px] px-2.5 rounded-xl text-xs font-medium bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-sm flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                </div>
              </div>

              {/* Mobile Quick Zoom Floating Pill + Collapsible Page Thumbnails */}
              <div className="flex items-center justify-between px-1">
                <div className="pointer-events-auto glass-level-2 border rounded-xl px-1.5 py-0.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.max(0.25, Number((z - 0.12).toFixed(2))))
                    }
                    aria-label="Zoom out"
                    className="min-w-[30px] min-h-[30px] flex items-center justify-center text-slate-600 dark:text-slate-300"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-200 px-0.5">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.min(2.5, Number((z + 0.12).toFixed(2))))
                    }
                    aria-label="Zoom in"
                    className="min-w-[30px] min-h-[30px] flex items-center justify-center text-slate-600 dark:text-slate-300"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                {cropMode && (
                  <button
                    type="button"
                    onClick={() => setCropMode(false)}
                    className="pointer-events-auto px-2.5 min-h-[32px] rounded-xl bg-emerald-600 text-white text-[11px] font-medium shadow-sm flex items-center gap-1"
                  >
                    <Crop className="w-3 h-3" />
                    Done Crop
                  </button>
                )}
              </div>

              {/* Collapsible Mobile Page Thumbnail Navigator */}
              {showMobileThumbStrip && (
                <div className="pointer-events-auto glass-level-3 border rounded-2xl p-2 space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      Pages ({project.pageCount})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleDuplicatePage}
                        className="px-2 py-1 rounded-lg border border-slate-300/70 dark:border-white/15 text-[10px] font-medium flex items-center gap-1"
                      >
                        <CopyPlus className="w-3 h-3" />
                        Dup Page
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMobileThumbStrip(false)}
                        aria-label="Collapse thumbnails"
                        className="p-1 text-slate-400"
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
                            className={`snap-start shrink-0 w-16 p-1 rounded-xl border text-center ${
                              isActive
                                ? 'border-blue-500 bg-blue-500/15'
                                : 'border-slate-200/70 dark:border-white/10'
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
                                <span className="text-[10px] font-mono text-slate-400">
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
                </div>
              )}
            </div>
          )}

          {/* Central Konva PDF Stage (Document canvas stays opaque & uncluttered) */}
          <PdfCanvasStage
            pageConfig={project.pageConfig}
            backgroundImageUrl={pageBgUrl}
            originalPageSize={currentMeta}
            elements={pageElements}
            selectedIds={selectedIds}
            zoom={zoom}
            interactionMode={stageInteractionMode}
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
          />

          {/* Floating Contextual Selection Toolbar (Desktop & Mobile) */}
          {selectedElements.length > 0 && editorMode !== 'preview' && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 z-30 max-w-[94vw] pointer-events-auto ${
                viewport.isMobile ? 'bottom-3' : 'bottom-4'
              }`}
            >
              <div className="glass-level-3 border rounded-2xl px-2 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar">
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 px-1.5 tabular-nums whitespace-nowrap">
                  {selectedElements.length === 1
                    ? primarySelected?.type.replace('_', ' ')
                    : `${selectedElements.length} selected`}
                </span>
                <div className="h-4 w-px bg-slate-300/60 dark:bg-white/10" />

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
                      className={`min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl ${
                        primarySelected.fontWeight === 'bold'
                          ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/10'
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
                        className={`min-w-[32px] min-h-[34px] flex items-center justify-center rounded-xl ${
                          primarySelected.align === al
                            ? 'bg-blue-500/18 text-blue-600 dark:text-blue-300'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-white/10'
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
                      className="px-2 min-h-[34px] rounded-xl text-[11px] font-medium hover:bg-slate-200/50 dark:hover:bg-white/10"
                    >
                      Align L
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAlignSelected('center')}
                      className="px-2 min-h-[34px] rounded-xl text-[11px] font-medium hover:bg-slate-200/50 dark:hover:bg-white/10"
                    >
                      Align C
                    </button>
                    <button
                      type="button"
                      onClick={handleGroupToggle}
                      className="px-2 min-h-[34px] rounded-xl text-[11px] font-medium hover:bg-slate-200/50 dark:hover:bg-white/10"
                    >
                      {primarySelected?.groupId ? 'Ungroup' : 'Group'}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  title="Duplicate"
                  onClick={handleDuplicateSelected}
                  className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/10"
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
                    className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-white/10"
                  >
                    {primarySelected.locked ? (
                      <Lock className="w-3.5 h-3.5 text-amber-500" />
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
                    className="px-2.5 min-h-[34px] rounded-xl bg-blue-600 text-white text-[11px] font-medium flex items-center gap-1"
                  >
                    <Sliders className="w-3 h-3" />
                    Edit
                  </button>
                )}

                <button
                  type="button"
                  title="Delete"
                  onClick={handleDeleteSelected}
                  className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xl text-red-500 hover:bg-red-500/12"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Desktop Resizable Right Properties Inspector */}
        {viewport.isDesktop && showDesktopInspector && (
          <div className="relative shrink-0 flex">
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize properties inspector"
              onMouseDown={(e) => startResizeSidePanel('inspector', e)}
              className="w-1.5 -mr-0.5 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors z-10 shrink-0"
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
            />
          </div>
        )}

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
            />
          </GlassBottomSheet>
        )}

        {/* Mobile Adaptive GlassBottomSheet: Add Elements & Canvas Tools */}
        {viewport.isMobile && (
          <GlassBottomSheet
            isOpen={mobileAddSheetOpen}
            snapState="medium"
            onClose={() => setMobileAddSheetOpen(false)}
            title="Insert & Workspace Tools"
            subtitle="Add text, shapes, tables, images, or toggle guides"
          >
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['Text', TypeIcon, () => addNewElement('text')],
                    ['Rectangle', Square, () => addNewElement('rect')],
                    ['Circle', Circle, () => addNewElement('circle')],
                    ['Line', Minus, () => addNewElement('line')],
                    ['Table', Table2, () => addNewElement('table')],
                    ['Block', BoxSelect, handleCreateDocumentBlock],
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
                    className="min-h-[60px] p-2.5 rounded-2xl border glass-level-3 flex flex-col items-center justify-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-100"
                  >
                    <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
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
                  className="min-h-[46px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium"
                >
                  <ImageIcon className="w-4 h-4 text-blue-500" />
                  Upload Image
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSelectMode('edit');
                    setCropMode((v) => !v);
                    setMobileAddSheetOpen(false);
                  }}
                  className={`min-h-[46px] px-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-medium ${
                    cropMode
                      ? 'bg-emerald-600 text-white border-emerald-500'
                      : 'glass-level-3'
                  }`}
                >
                  <Crop className="w-4 h-4" />
                  Visual Crop
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSearchBar((v) => !v);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[46px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium"
                >
                  <Search className="w-4 h-4 text-indigo-500" />
                  Find & Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowVersionModal(true);
                    setMobileAddSheetOpen(false);
                  }}
                  className="min-h-[46px] px-3 rounded-xl border glass-level-3 flex items-center justify-center gap-2 text-xs font-medium"
                >
                  <History className="w-4 h-4 text-amber-500" />
                  Version History
                </button>
              </div>
            </div>
          </GlassBottomSheet>
        )}

        {/* Tablet Slide-Out Layers, Pages & Inspector Drawers */}
        {viewport.isTablet && showLayersPanel && (
          <div
            className="fixed inset-0 z-40 bg-black/45 flex"
            onClick={() => setShowLayersPanel(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[85vw] max-w-xs h-full glass-level-4 border-r"
            >
              {renderLayersList(true)}
            </div>
          </div>
        )}

        {viewport.isTablet && showPagesDrawer && (
          <div
            className="fixed inset-0 z-40 bg-black/45 flex"
            onClick={() => setShowPagesDrawer(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[85vw] max-w-xs h-full glass-level-4 border-r"
            >
              {renderPagesDrawerContent()}
            </div>
          </div>
        )}

        {viewport.isTablet && showInspectorDrawer && (
          <div
            className="fixed inset-0 z-40 bg-black/45 flex justify-end"
            onClick={() => setShowInspectorDrawer(false)}
          >
            <div
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
              />
            </div>
          </div>
        )}
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
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                editorMode === 'preview'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>{editorMode === 'preview' ? 'Preview' : 'Edit'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectMode('layers')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                showLayersPanel
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Layers</span>
            </button>

            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => setMobileAddSheetOpen(true)}
                aria-label="Add element or tool"
                className="min-w-[48px] min-h-[40px] px-3 rounded-2xl bg-gradient-to-b from-blue-500 to-blue-600 text-white border border-white/35 shadow-md flex items-center justify-center active:scale-[0.96] transition-transform"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleSelectMode('properties')}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                showInspectorDrawer
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Props</span>
            </button>

            <button
              type="button"
              onClick={() => setShowMobileThumbStrip((v) => !v)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                showMobileThumbStrip
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
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
          onUpdateProject({
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
            updatedAt: new Date().toISOString(),
          });
        }}
      />

      <VersionHistoryModal
        isOpen={showVersionModal}
        project={project}
        onClose={() => setShowVersionModal(false)}
        onSaveNamedVersion={(note) => {
          onSaveSnapshot(project, note);
        }}
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
    </div>
  );
};
