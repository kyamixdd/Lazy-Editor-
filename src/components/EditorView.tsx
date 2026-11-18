import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
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
  Grid,
  Group,
  Image as ImageIcon,
  Layers,
  Lock,
  Magnet,
  Maximize2,
  Minus,
  Redo2,
  Ruler,
  Save,
  Search,
  Sliders,
  Square,
  Table2,
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
  DocumentElement,
  PageConfig,
  PDFProject,
  RectPt,
  SourceFitConfig,
  StudioSettings,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
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
import { PageConfigurationModal } from './PageConfigurationModal';
import { PdfCanvasStage } from './PdfCanvasStage';
import { PropertiesInspector } from './PropertiesInspector';

interface EditorViewProps {
  project: PDFProject;
  settings: StudioSettings;
  onUpdateProject: (updated: PDFProject) => void;
  onSaveSnapshot: (project: PDFProject, note: string) => void;
}

type EditorMode = 'preview' | 'edit' | 'layers' | 'properties' | 'pages';

export const EditorView: React.FC<EditorViewProps> = ({
  project,
  settings,
  onUpdateProject,
  onSaveSnapshot,
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
  const [showLayersPanel, setShowLayersPanel] = useState(true);
  const [showPagesDrawer, setShowPagesDrawer] = useState(false);
  const [showInspectorDrawer, setShowInspectorDrawer] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [showPageSetupModal, setShowPageSetupModal] = useState(false);
  const [redetectingBounds, setRedetectingBounds] = useState(false);
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

  // Clamp currentPage when switching projects
  useEffect(() => {
    setCurrentPage((p) => Math.max(1, Math.min(p, Math.max(1, project.pageCount))));
  }, [project.id, project.pageCount]);

  // Lazy-render page thumbnails when Pages drawer opens
  useEffect(() => {
    const pagesOpen =
      showPagesDrawer || (viewport.isMobile && editorMode === 'pages');
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
    recordHistory = true
  ) => {
    if (recordHistory) {
      setUndoStack((prev) => [...prev.slice(-40), project.elements]);
      setRedoStack([]);
    }
    onUpdateProject({
      ...project,
      elements: nextElements,
      updatedAt: new Date().toISOString(),
    });
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
    const clones: DocumentElement[] = project.elements
      .filter((e) => selectedIds.includes(e.id))
      .map((e) => ({
        ...structuredClone(e),
        id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x: e.x + 14,
        y: e.y + 14,
        isUserAdded: true,
        eraseOriginal: false,
        sourceOriginalRect: undefined,
      }));
    commitElements([...project.elements, ...clones]);
    setSelectedIds(clones.map((c) => c.id));
  };

  const handleDuplicateElementById = (id: string) => {
    const src = project.elements.find((e) => e.id === id);
    if (!src) return;
    const clone: DocumentElement = {
      ...structuredClone(src),
      id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x: src.x + 14,
      y: src.y + 14,
      isUserAdded: true,
      eraseOriginal: false,
      sourceOriginalRect: undefined,
    };
    commitElements([...project.elements, clone]);
    setSelectedIds([clone.id]);
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
      x: e.x + 18,
      y: e.y + 18,
      isUserAdded: true,
      eraseOriginal: false,
      sourceOriginalRect: undefined,
    }));
    commitElements([...project.elements, ...pasted]);
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
          )
        );
      }
      return;
    }
    const newGroupId = `grp-${Date.now()}`;
    const set = new Set(selectedIds);
    commitElements(
      project.elements.map((e) =>
        set.has(e.id) ? { ...e, groupId: newGroupId } : e
      )
    );
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
    commitElements([...project.elements, base]);
    setSelectedIds([id]);
    setInspectorTab('element');
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
        };
        commitElements([...project.elements, el]);
        setSelectedIds([id]);
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

  const pageElements = project.elements.filter(
    (e) => e.pageNumber === currentPage
  );
  const selectedElements = pageElements.filter((e) =>
    selectedIds.includes(e.id)
  );
  const reviewQueueCount = pageElements.filter((e) => e.needsReview).length;

  const stageInteractionMode: 'preview' | 'edit' =
    editorMode === 'preview' ? 'preview' : 'edit';

  const handleSelectMode = (mode: EditorMode) => {
    setEditorMode(mode);
    if (viewport.isMobile) {
      setShowLayersPanel(mode === 'layers');
      setShowInspectorDrawer(mode === 'properties');
      setShowPagesDrawer(mode === 'pages');
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

  const renderLayersList = (touchFriendly: boolean) => (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 shrink-0">
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
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              aria-label="Close layers"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

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

  return (
    <div className="flex-1 flex flex-col h-full desktop:h-screen overflow-hidden relative">
      {/* Desktop & Tablet Top Toolbar */}
      {!viewport.isMobile ? (
        <header className="h-12 px-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E131D] flex items-center justify-between gap-2 overflow-x-auto shrink-0">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              title="Toggle Layers"
              onClick={() => setShowLayersPanel((v) => !v)}
              className={`p-1.5 rounded ${
                showLayersPanel
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Layers className="w-4 h-4" />
            </button>

            <button
              type="button"
              title="Page Thumbnails"
              onClick={() => setShowPagesDrawer((v) => !v)}
              className={`p-1.5 rounded ${
                showPagesDrawer
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <BookOpen className="w-4 h-4" />
            </button>

            {viewport.isTablet && (
              <button
                type="button"
                title="Properties & AI"
                onClick={() => setShowInspectorDrawer((v) => !v)}
                className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
                  showInspectorDrawer
                    ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Props
              </button>
            )}

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

            <button
              type="button"
              title="Undo"
              disabled={undoStack.length === 0}
              onClick={handleUndo}
              className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Redo"
              disabled={redoStack.length === 0}
              onClick={handleRedo}
              className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
            >
              <Redo2 className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

            <button
              type="button"
              title="Add Text"
              onClick={() => addNewElement('text')}
              className="px-2 py-1 rounded text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 whitespace-nowrap"
            >
              <TypeIcon className="w-3.5 h-3.5" />
              Text
            </button>
            <button
              type="button"
              title="Add Rectangle"
              onClick={() => addNewElement('rect')}
              className="p-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Add Circle"
              onClick={() => addNewElement('circle')}
              className="p-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Circle className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Add Line"
              onClick={() => addNewElement('line')}
              className="p-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Add Table"
              onClick={() => addNewElement('table')}
              className="p-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Table2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Create Document Block (from selection or new frame)"
              onClick={handleCreateDocumentBlock}
              className="px-2 py-1 rounded text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 whitespace-nowrap"
            >
              <BoxSelect className="w-3.5 h-3.5" />
              Block
            </button>
            <button
              type="button"
              title="Add Image / Logo"
              onClick={() => imageUploadRef.current?.click()}
              className="p-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

            <button
              type="button"
              title="Copy selected"
              disabled={selectedIds.length === 0}
              onClick={handleCopy}
              className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Paste"
              disabled={clipboard.length === 0}
              onClick={handlePaste}
              className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Group / Ungroup"
              disabled={selectedIds.length === 0}
              onClick={handleGroupToggle}
              className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
            >
              {selectedElements[0]?.groupId ? (
                <Ungroup className="w-3.5 h-3.5" />
              ) : (
                <Group className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              title="Search & Replace"
              onClick={() => setShowSearchBar((v) => !v)}
              className={`p-1.5 rounded ${
                showSearchBar
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              title="Preview vs Edit Mode"
              onClick={() =>
                setEditorMode((m) => (m === 'preview' ? 'edit' : 'preview'))
              }
              className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 whitespace-nowrap ${
                editorMode === 'preview'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              {editorMode === 'preview' ? 'Preview' : 'Edit'}
            </button>
            <button
              type="button"
              title="Rulers"
              onClick={() => setShowRulers((v) => !v)}
              className={`p-1.5 rounded ${
                showRulers
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Ruler className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Grid"
              onClick={() => setShowGrid((v) => !v)}
              className={`p-1.5 rounded ${
                showGrid
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Snap to Grid & Alignment Guides"
              onClick={() => {
                setSnapToGrid((v) => !v);
                setShowGuides((v) => !v);
              }}
              className={`p-1.5 rounded ${
                snapToGrid
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Magnet className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Visual Crop & Content Boundary Handles"
              onClick={() => {
                setCropMode((v) => {
                  const next = !v;
                  if (next) setInspectorTab('page');
                  return next;
                });
              }}
              className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 whitespace-nowrap ${
                cropMode
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Crop className="w-3.5 h-3.5" />
              Crop
            </button>
            <button
              type="button"
              title="Custom Paper Size, Units, Margins & Presets"
              onClick={() => setShowPageSetupModal(true)}
              className="px-2 py-1 rounded text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 whitespace-nowrap"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {project.pageConfig.customPresetName || project.pageConfig.sizePreset}
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.max(0.3, Number((z - 0.15).toFixed(2))))
              }
              className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
              className="p-1.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
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
              className="p-1 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              title="Duplicate Entire PDF Page"
              onClick={handleDuplicatePage}
              className="px-2 py-1 rounded text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 whitespace-nowrap"
            >
              <CopyPlus className="w-3.5 h-3.5" />
              Dup Page
            </button>

            <button
              type="button"
              onClick={() =>
                onSaveSnapshot(project, `Manual snapshot (Page ${currentPage})`)
              }
              className="ml-1 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
        </header>
      ) : (
        /* Mobile Compact Top Contextual Bar */
        <header className="h-11 px-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E131D] flex items-center justify-between gap-1 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.max(0.25, Number((z - 0.12).toFixed(2))))
              }
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded text-slate-600 dark:text-slate-300"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() =>
                setZoom((z) => Math.min(2.5, Number((z + 0.12).toFixed(2))))
              }
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded text-slate-600 dark:text-slate-300"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="min-w-[34px] min-h-[36px] flex items-center justify-center rounded text-slate-600 dark:text-slate-300 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleSelectMode('pages')}
              className="px-2 min-h-[32px] rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-200"
            >
              {currentPage}/{project.pageCount}
            </button>
            <button
              type="button"
              disabled={currentPage >= project.pageCount}
              onClick={() =>
                setCurrentPage((p) => Math.min(project.pageCount, p + 1))
              }
              className="min-w-[34px] min-h-[36px] flex items-center justify-center rounded text-slate-600 dark:text-slate-300 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowPageSetupModal(true)}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Page settings"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                onSaveSnapshot(project, `Manual snapshot (Page ${currentPage})`)
              }
              className="min-h-[34px] px-2.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1"
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
        <div className="px-3 tablet:px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111827] flex flex-wrap items-center gap-2 text-xs shrink-0">
          <input
            type="text"
            placeholder="Find text..."
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            className="flex-1 min-w-[120px] min-h-[38px] tablet:min-h-0 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <input
            type="text"
            placeholder="Replace with..."
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            className="flex-1 min-w-[120px] min-h-[38px] tablet:min-h-0 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <button
            type="button"
            onClick={handleSearchAndReplace}
            className="min-h-[38px] tablet:min-h-0 px-3 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
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

      {/* Main Workspace Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop Permanent Left Layers Panel */}
        {viewport.isDesktop && showLayersPanel && (
          <aside className="w-56 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E131D] flex flex-col overflow-hidden">
            {renderLayersList(false)}
          </aside>
        )}

        {/* Desktop Pages Strip Drawer */}
        {viewport.isDesktop && showPagesDrawer && (
          <aside className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E131D] flex flex-col overflow-hidden">
            {renderPagesDrawerContent()}
          </aside>
        )}

        {/* Central Interactive Konva Stage */}
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
          showAlignmentGuides={showGuides}
          gridSizePt={settings.gridSizePt}
          cropMode={cropMode}
          fitConfig={fitConfig}
          activeSourceBox={currentLayout.sourceBox}
          detectedContentBox={currentMeta?.contentBBox}
          onZoomChange={setZoom}
          onOpenProperties={() => {
            setInspectorTab('element');
            if (viewport.isMobile) {
              handleSelectMode('properties');
            } else if (viewport.isTablet) {
              setShowInspectorDrawer(true);
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

        {/* Desktop Permanent Right Properties Inspector */}
        {viewport.isDesktop && (
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
            onReorderElement={handleReorderElement}
            onUpdateElement={handleUpdateElement}
            onDeleteSelected={handleDeleteSelected}
            onDuplicateSelected={handleDuplicateSelected}
            onUpdatePageConfig={handleUpdatePageConfig}
            onUpdateFitConfig={handleUpdateFitConfig}
            onToggleCropMode={() => setCropMode((v) => !v)}
            onRedetectBounds={handleRedetectBounds}
            onApplyAiPlan={handleApplyAiPlan}
            onOpenPageSetup={() => setShowPageSetupModal(true)}
          />
        )}

        {/* Mobile/Tablet Slide-Out Layers Drawer */}
        {!viewport.isDesktop && showLayersPanel && (
          <div
            className="fixed inset-0 z-40 bg-black/45 flex"
            onClick={() => {
              setShowLayersPanel(false);
              if (viewport.isMobile) setEditorMode('edit');
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[85vw] max-w-xs h-full bg-white dark:bg-[#0E131D] border-r border-slate-200 dark:border-slate-800 shadow-2xl"
            >
              {renderLayersList(true)}
            </div>
          </div>
        )}

        {/* Mobile/Tablet Slide-Out Pages Thumbnail Drawer */}
        {!viewport.isDesktop && showPagesDrawer && (
          <div
            className="fixed inset-0 z-40 bg-black/45 flex"
            onClick={() => {
              setShowPagesDrawer(false);
              if (viewport.isMobile) setEditorMode('edit');
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[85vw] max-w-xs h-full bg-white dark:bg-[#0E131D] border-r border-slate-200 dark:border-slate-800 shadow-2xl"
            >
              {renderPagesDrawerContent()}
            </div>
          </div>
        )}

        {/* Mobile/Tablet Slide-Out Properties & AI Drawer */}
        {!viewport.isDesktop && showInspectorDrawer && (
          <div
            className="fixed inset-0 z-40 bg-black/45 flex justify-end"
            onClick={() => {
              setShowInspectorDrawer(false);
              if (viewport.isMobile) setEditorMode('edit');
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full tablet:w-96 max-w-md h-full bg-white dark:bg-[#0E131D] border-l border-slate-200 dark:border-slate-800 shadow-2xl"
            >
              <PropertiesInspector
                isDrawer
                onCloseDrawer={() => {
                  setShowInspectorDrawer(false);
                  if (viewport.isMobile) setEditorMode('edit');
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
                onReorderElement={handleReorderElement}
                onUpdateElement={handleUpdateElement}
                onDeleteSelected={handleDeleteSelected}
                onDuplicateSelected={handleDuplicateSelected}
                onUpdatePageConfig={handleUpdatePageConfig}
                onUpdateFitConfig={handleUpdateFitConfig}
                onToggleCropMode={() => setCropMode((v) => !v)}
                onRedetectBounds={handleRedetectBounds}
                onApplyAiPlan={handleApplyAiPlan}
                onOpenPageSetup={() => {
                  setShowInspectorDrawer(false);
                  setShowPageSetupModal(true);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile Collapsible Bottom Toolbar + 5-Mode Switcher */}
      {viewport.isMobile && (
        <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E131D] shrink-0 pb-safe z-30">
          {bottomToolsOpen && (
            <div className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1 overflow-x-auto bg-slate-50 dark:bg-[#0B0F17]">
              <button
                type="button"
                disabled={undoStack.length === 0}
                onClick={handleUndo}
                className="min-w-[40px] min-h-[40px] px-2 rounded flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-30 shrink-0"
                title="Undo"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={redoStack.length === 0}
                onClick={handleRedo}
                className="min-w-[40px] min-h-[40px] px-2 rounded flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-30 shrink-0"
                title="Redo"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectMode('edit');
                  addNewElement('text');
                }}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <TypeIcon className="w-3.5 h-3.5" />
                Text
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectMode('edit');
                  addNewElement('rect');
                }}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                Rect
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectMode('edit');
                  addNewElement('circle');
                }}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <Circle className="w-3.5 h-3.5" />
                Circle
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectMode('edit');
                  addNewElement('line');
                }}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <Minus className="w-3.5 h-3.5" />
                Line
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectMode('edit');
                  addNewElement('table');
                }}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <Table2 className="w-3.5 h-3.5" />
                Table
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectMode('edit');
                  handleCreateDocumentBlock();
                }}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <BoxSelect className="w-3.5 h-3.5" />
                Block
              </button>
              <button
                type="button"
                onClick={() => imageUploadRef.current?.click()}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Img
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectMode('edit');
                  setCropMode((v) => !v);
                }}
                className={`min-h-[40px] px-2.5 rounded text-xs font-medium border flex items-center gap-1 shrink-0 ${
                  cropMode
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                }`}
              >
                <Crop className="w-3.5 h-3.5" />
                Crop
              </button>
              <button
                type="button"
                onClick={() => setShowSearchBar((v) => !v)}
                className="min-h-[40px] px-2.5 rounded text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1 shrink-0"
              >
                <Search className="w-3.5 h-3.5" />
                Find
              </button>
            </div>
          )}

          {/* Mode Switcher + Collapse Toggle */}
          <div className="flex items-center px-1">
            <div className="flex-1 grid grid-cols-5">
              {(
                [
                  ['preview', 'Preview', Eye],
                  ['edit', 'Edit', Edit3],
                  ['layers', 'Layers', Layers],
                  ['properties', 'Props', Sliders],
                  ['pages', 'Pages', BookOpen],
                ] as const
              ).map(([modeId, label, Icon]) => {
                const active = editorMode === modeId;
                return (
                  <button
                    key={modeId}
                    type="button"
                    onClick={() => handleSelectMode(modeId)}
                    className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                      active
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setBottomToolsOpen((v) => !v)}
              title={bottomToolsOpen ? 'Collapse tools' : 'Expand tools'}
              className="min-w-[40px] min-h-[48px] flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 border-l border-slate-200 dark:border-slate-800"
            >
              {bottomToolsOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
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
    </div>
  );
};
