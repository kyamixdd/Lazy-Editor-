import React, { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Edit3,
  Lock,
  Sliders,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  MOTION_DURATION,
  MOTION_SPRING,
  modalBackdropVariants,
  modalPanelVariants,
  popoverVariants,
} from '../config/motionSystem';
import {
  ActiveEditorTool,
  BarcodeFormat,
  DocumentElement,
  MeasurementUnit,
  PageConfig,
  RectPt,
  SourceFitConfig,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import {
  computeSmartSnapAndGuides,
  getElementsInMarquee,
} from '../utils/alignmentEngine';
import { encodeBarcode } from '../utils/barcodeEngine';
import { clampRect } from '../utils/geometryEngine';
import {
  mergeTableCellRange,
  splitMergedTableCell,
} from '../utils/tableReconstructionEngine';
import { computeTypographyLayout } from '../utils/typographyEngine';
import { ptToUnit } from '../utils/units';

interface PdfCanvasStageProps {
  pageConfig: PageConfig;
  backgroundImageUrl?: string;
  originalPageSize?: { widthPt: number; heightPt: number };
  elements: DocumentElement[];
  selectedIds: string[];
  zoom: number;
  interactionMode?: 'preview' | 'edit';
  activeTool?: ActiveEditorTool;
  stylePainterActive?: boolean;
  currentPageNumber?: number;
  measureUnit?: MeasurementUnit;
  showRulers: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  snapToObjects?: boolean;
  snapThresholdPt?: number;
  showAlignmentGuides: boolean;
  gridSizePt: number;
  cropMode: boolean;
  fitConfig: SourceFitConfig;
  activeSourceBox: RectPt;
  detectedContentBox?: RectPt;
  highlightedElementId?: string | null;
  onZoomChange?: (zoom: number) => void;
  onOpenProperties?: () => void;
  onDuplicateElement?: (id: string) => void;
  onDeleteElement?: (id: string) => void;
  onReorderElement?: (
    id: string,
    dir: 'front' | 'back' | 'forward' | 'backward'
  ) => void;
  onChangeCropRect: (rect: RectPt) => void;
  onSelectIds: (ids: string[]) => void;
  onUpdateElement: (id: string, patch: Partial<DocumentElement>) => void;
  onUpdateElementsBatch: (
    updates: Array<{ id: string; patch: Partial<DocumentElement> }>
  ) => void;
  onCreateElement?: (element: DocumentElement) => void;
  onStylePaintTarget?: (targetId: string) => void;
}

function mapFontToCanvasCss(fontFamily: string): string {
  const f = (fontFamily || '').toLowerCase();
  if (f.includes('times') || f.includes('serif')) {
    return 'Times New Roman, Times, serif';
  }
  if (f.includes('courier') || f.includes('mono')) {
    return 'Courier New, Courier, monospace';
  }
  return fontFamily || 'Helvetica, Arial, sans-serif';
}

export const PdfCanvasStage: React.FC<PdfCanvasStageProps> = ({
  pageConfig,
  backgroundImageUrl,
  originalPageSize,
  elements,
  selectedIds,
  zoom,
  interactionMode = 'edit',
  activeTool = 'select',
  stylePainterActive = false,
  currentPageNumber = 1,
  measureUnit = 'mm',
  showRulers,
  showGrid,
  snapToGrid,
  snapToObjects = true,
  snapThresholdPt = 6,
  showAlignmentGuides,
  gridSizePt,
  cropMode,
  fitConfig,
  activeSourceBox,
  detectedContentBox,
  highlightedElementId,
  onZoomChange,
  onOpenProperties,
  onDuplicateElement,
  onDeleteElement,
  onReorderElement,
  onChangeCropRect,
  onSelectIds,
  onUpdateElement,
  onUpdateElementsBatch,
  onCreateElement,
  onStylePaintTarget,
}) => {
  const viewport = useViewport();
  const scrollWrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const bgLayerRef = useRef<Konva.Layer | null>(null);
  const gridLayerRef = useRef<Konva.Layer | null>(null);
  const elementsLayerRef = useRef<Konva.Layer | null>(null);
  const guideLayerRef = useRef<Konva.Layer | null>(null);
  const cropLayerRef = useRef<Konva.Layer | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const cropTransformerRef = useRef<Konva.Transformer | null>(null);
  const nodeMapRef = useRef<Map<string, Konva.Node>>(new Map());

  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastTouchEventAtRef = useRef<number>(0);
  const isManipulatingRef = useRef<boolean>(false);
  const pendingNarrowIdRef = useRef<string | null>(null);
  const highlightRectRef = useRef<Konva.Rect | null>(null);
  const stageBoxRef = useRef<HTMLDivElement>(null);
  const touchGestureRef = useRef<{
    active: boolean;
    initialDist: number;
    initialZoom: number;
    lastMidX: number;
    lastMidY: number;
  }>({
    active: false,
    initialDist: 0,
    initialZoom: 1,
    lastMidX: 0,
    lastMidY: 0,
  });

  const [bgImgObj, setBgImgObj] = useState<HTMLImageElement | null>(null);
  const [elementImgs, setElementImgs] = useState<
    Record<string, { src: string; img: HTMLImageElement }>
  >({});
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineText, setInlineText] = useState('');
  const [tableEditId, setTableEditId] = useState<string | null>(null);
  const [tableCellSel, setTableCellSel] = useState<{
    r1: number;
    c1: number;
    r2: number;
    c2: number;
  } | null>(null);
  const [isManipulating, setIsManipulating] = useState(false);
  const [liveMeasureHint, setLiveMeasureHint] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    elementId: string;
    x: number;
    y: number;
  } | null>(null);

  const canvasW = originalPageSize?.widthPt || pageConfig.widthPt;
  const canvasH = originalPageSize?.heightPt || pageConfig.heightPt;
  const isTouchLargeHandles = viewport.isTouchDevice || viewport.isMobile;
  const effectiveRulers = showRulers && !viewport.isMobile;

  // Keep latest callbacks in refs to avoid recreating Konva stage on every render
  const callbacksRef = useRef({
    onSelectIds,
    onUpdateElement,
    onUpdateElementsBatch,
    onChangeCropRect,
    onZoomChange,
    onCreateElement,
    onStylePaintTarget,
    selectedIds,
    elements,
    snapToGrid,
    snapToObjects,
    snapThresholdPt,
    showAlignmentGuides,
    gridSizePt,
    zoom,
    canvasW,
    canvasH,
    interactionMode,
    cropMode,
    activeTool,
    stylePainterActive,
    currentPageNumber,
    measureUnit,
    viewportWidth: viewport.width,
    isTouchLargeHandles,
  });
  callbacksRef.current = {
    onSelectIds,
    onUpdateElement,
    onUpdateElementsBatch,
    onChangeCropRect,
    onZoomChange,
    onCreateElement,
    onStylePaintTarget,
    selectedIds,
    elements,
    snapToGrid,
    snapToObjects,
    snapThresholdPt,
    showAlignmentGuides,
    gridSizePt,
    zoom,
    canvasW,
    canvasH,
    interactionMode,
    cropMode,
    activeTool,
    stylePainterActive,
    currentPageNumber,
    measureUnit,
    viewportWidth: viewport.width,
    isTouchLargeHandles,
  };

  const marqueeRef = useRef<{
    active: boolean;
    mode: 'marquee' | 'draw' | 'box' | 'line';
    tool: ActiveEditorTool;
    startX: number;
    startY: number;
    points: number[];
    rectNode: Konva.Rect | null;
    lineNode: Konva.Line | null;
    shiftHeld: boolean;
  }>({
    active: false,
    mode: 'marquee',
    tool: 'select',
    startX: 0,
    startY: 0,
    points: [],
    rectNode: null,
    lineNode: null,
    shiftHeld: false,
  });

  const stageW = Math.round(canvasW * zoom);
  const stageH = Math.round(canvasH * zoom);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartPosRef.current = null;
  };

  // Auto-fit zoom on mobile/tablet when canvas page dimensions change
  const lastAutoFitKeyRef = useRef<string>('');
  useEffect(() => {
    if (!onZoomChange) return;
    if (viewport.isDesktop) return;
    const wrapper = scrollWrapperRef.current;
    const availW = wrapper ? Math.max(240, wrapper.clientWidth - 24) : Math.max(240, viewport.width - 24);
    const key = `${viewport.breakpoint}:${canvasW}`;
    if (lastAutoFitKeyRef.current === key) return;
    lastAutoFitKeyRef.current = key;
    const fitZoom = Number(Math.max(0.3, Math.min(1.2, availW / Math.max(1, canvasW))).toFixed(2));
    onZoomChange(fitZoom);
  }, [viewport.breakpoint, viewport.isDesktop, viewport.width, canvasW, onZoomChange]);

  // Load background PDF page image
  useEffect(() => {
    let cancelled = false;
    if (!backgroundImageUrl) {
      setBgImgObj(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setBgImgObj(img);
    };
    img.onerror = () => {
      if (!cancelled) setBgImgObj(null);
    };
    img.src = backgroundImageUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [backgroundImageUrl]);

  // Load any added element images & signatures (reloads cleanly on image replacement)
  useEffect(() => {
    elements.forEach((el) => {
      if (
        (el.type === 'image' || el.type === 'signature') &&
        el.imageDataUrl &&
        elementImgs[el.id]?.src !== el.imageDataUrl
      ) {
        const src = el.imageDataUrl;
        const img = new Image();
        img.onload = () => {
          setElementImgs((prev) => ({ ...prev, [el.id]: { src, img } }));
        };
        img.src = src;
      }
    });
  }, [elements, elementImgs]);

  // Initialize Konva Stage once
  useEffect(() => {
    if (!containerRef.current) return;
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: stageW,
      height: stageH,
    });

    const bgLayer = new Konva.Layer({ listening: false });
    const gridLayer = new Konva.Layer({ listening: false });
    const elementsLayer = new Konva.Layer();
    const guideLayer = new Konva.Layer({ listening: false });
    const cropLayer = new Konva.Layer();

    const tr = new Konva.Transformer({
      rotateEnabled: true,
      borderStroke: '#101010',
      borderStrokeWidth: isTouchLargeHandles ? 2 : 1.5,
      anchorStroke: '#101010',
      anchorFill: '#FFFFFF',
      anchorSize: isTouchLargeHandles ? 16 : 7,
      anchorCornerRadius: isTouchLargeHandles ? 4 : 0,
      padding: isTouchLargeHandles ? 5 : 0,
      rotateAnchorOffset: isTouchLargeHandles ? 30 : 22,
      keepRatio: false,
      boundBoxFunc: (oldBox, newBox) => {
        if (newBox.width < 8 || newBox.height < 6) return oldBox;
        return newBox;
      },
    });
    elementsLayer.add(tr);

    const cropTr = new Konva.Transformer({
      rotateEnabled: false,
      borderStroke: '#101010',
      borderStrokeWidth: isTouchLargeHandles ? 2.2 : 1.8,
      anchorStroke: '#101010',
      anchorFill: '#FFFFFF',
      anchorSize: isTouchLargeHandles ? 18 : 8,
      anchorCornerRadius: isTouchLargeHandles ? 4 : 0,
      keepRatio: false,
      boundBoxFunc: (oldBox, newBox) => {
        if (newBox.width < 16 || newBox.height < 16) return oldBox;
        return newBox;
      },
    });
    cropLayer.add(cropTr);

    stage.add(bgLayer);
    stage.add(gridLayer);
    stage.add(elementsLayer);
    stage.add(guideLayer);
    stage.add(cropLayer);

    const cancelTransientStageGesture = () => {
      const m = marqueeRef.current;
      if (m.active) {
        m.rectNode?.destroy();
        m.lineNode?.destroy();
        marqueeRef.current = {
          active: false,
          mode: 'marquee',
          tool: 'select',
          startX: 0,
          startY: 0,
          points: [],
          rectNode: null,
          lineNode: null,
          shiftHeld: false,
        };
        guideLayer.batchDraw();
      }
      isManipulatingRef.current = false;
      setIsManipulating(false);
      setLiveMeasureHint(null);
      clearLongPress();
    };

    tr.on('transformstart', () => {
      clearLongPress();
      isManipulatingRef.current = true;
      setIsManipulating(true);
    });

    tr.on('transformend', () => {
      isManipulatingRef.current = false;
      setIsManipulating(false);
      const nodes = tr.nodes();
      if (!nodes || nodes.length === 0) return;

      const updates: Array<{ id: string; patch: Partial<DocumentElement> }> = [];
      for (const node of nodes) {
        const id = node.id();
        const el = callbacksRef.current.elements.find((x) => x.id === id);
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        if (!el || el.locked) continue;

        const nextW = Number(Math.max(8, el.width * sx).toFixed(2));
        const nextH = Number(Math.max(8, el.height * sy).toFixed(2));
        const patch: Partial<DocumentElement> = {
          x: Number(node.x().toFixed(2)),
          y: Number(node.y().toFixed(2)),
          width: nextW,
          height: nextH,
          rotation: Math.round(node.rotation()),
          eraseOriginal: el.isUserAdded ? false : true,
        };

        // Proportionally scale relative vector points for freehand/line/polygon shapes
        if (el.points && el.points.length >= 4 && (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001)) {
          patch.points = el.points.map((val, idx) =>
            Number((val * (idx % 2 === 0 ? sx : sy)).toFixed(2))
          );
        }

        updates.push({ id, patch });
      }

      if (updates.length === 1) {
        callbacksRef.current.onUpdateElement(updates[0].id, updates[0].patch);
      } else if (updates.length > 1) {
        callbacksRef.current.onUpdateElementsBatch(updates);
      }
    });

    stage.on('mousedown touchstart', (e) => {
      const evtType = e.evt?.type || '';
      if (evtType === 'touchstart') {
        lastTouchEventAtRef.current = Date.now();
        const te = e.evt as unknown as TouchEvent;
        if (te.touches && te.touches.length >= 2) {
          cancelTransientStageGesture();
          return;
        }
      } else if (evtType === 'mousedown' && Date.now() - lastTouchEventAtRef.current < 450) {
        // Ignore browser-synthesized mouse event right after touchstart
        return;
      }

      const tool = callbacksRef.current.activeTool;
      const isCreationTool =
        tool !== 'select' &&
        tool !== 'marquee' &&
        tool !== 'inspect' &&
        tool !== 'style_painter' &&
        !callbacksRef.current.stylePainterActive;

      if (e.target === stage || isCreationTool || tool === 'marquee') {
        setInlineEditId(null);
        setContextMenu(null);
        const evt = e.evt as MouseEvent;
        const pos = stage.getPointerPosition();
        if (
          pos &&
          callbacksRef.current.interactionMode === 'edit' &&
          !callbacksRef.current.cropMode
        ) {
          const z = callbacksRef.current.zoom;
          const sx = pos.x / z;
          const sy = pos.y / z;

          if (tool === 'draw') {
            isManipulatingRef.current = true;
            setIsManipulating(true);
            const lineNode = new Konva.Line({
              points: [sx, sy],
              stroke: '#101010',
              strokeWidth: 2,
              lineCap: 'round',
              lineJoin: 'round',
              tension: 0.35,
              listening: false,
            });
            guideLayer.add(lineNode);
            marqueeRef.current = {
              active: true,
              mode: 'draw',
              tool,
              startX: sx,
              startY: sy,
              points: [sx, sy],
              rectNode: null,
              lineNode,
              shiftHeld: false,
            };
            return;
          }

          if (tool === 'measure' || tool === 'arrow' || tool === 'line') {
            isManipulatingRef.current = true;
            setIsManipulating(true);
            const lineNode = new Konva.Line({
              points: [sx, sy, sx, sy],
              stroke: '#101010',
              strokeWidth: 1.5,
              dash: tool === 'measure' ? [4 / z, 2 / z] : undefined,
              listening: false,
            });
            guideLayer.add(lineNode);
            marqueeRef.current = {
              active: true,
              mode: 'line',
              tool,
              startX: sx,
              startY: sy,
              points: [sx, sy, sx, sy],
              rectNode: null,
              lineNode,
              shiftHeld: false,
            };
            return;
          }

          if (
            tool === 'highlight' ||
            tool === 'underline_annot' ||
            tool === 'strikeout_annot' ||
            tool === 'redact' ||
            tool === 'rect' ||
            tool === 'circle' ||
            tool === 'callout' ||
            tool === 'note' ||
            tool === 'text'
          ) {
            isManipulatingRef.current = true;
            setIsManipulating(true);
            const boxNode = new Konva.Rect({
              x: sx,
              y: sy,
              width: 0,
              height: 0,
              fill:
                tool === 'redact'
                  ? 'rgba(0,0,0,0.45)'
                  : tool === 'highlight'
                  ? 'rgba(200,200,200,0.35)'
                  : 'rgba(16,16,16,0.08)',
              stroke: '#101010',
              strokeWidth: 1 / z,
              dash: [4 / z, 2 / z],
              listening: false,
            });
            guideLayer.add(boxNode);
            marqueeRef.current = {
              active: true,
              mode: 'box',
              tool,
              startX: sx,
              startY: sy,
              points: [],
              rectNode: boxNode,
              lineNode: null,
              shiftHeld: false,
            };
            return;
          }

          const hasTouch = 'touches' in (evt as unknown as TouchEvent) && Boolean((evt as unknown as TouchEvent).touches?.length);
          const isLeftMouse = evt && 'button' in evt && !hasTouch && evt.button === 0;
          const allowMarquee =
            tool === 'marquee' ? e.target === stage || hasTouch || isLeftMouse : isLeftMouse && e.target === stage;
          if (allowMarquee) {
            isManipulatingRef.current = true;
            setIsManipulating(true);
            const marqueeRect = new Konva.Rect({
              x: sx,
              y: sy,
              width: 0,
              height: 0,
              fill: 'rgba(16, 16, 16, 0.08)',
              stroke: '#101010',
              strokeWidth: 1 / z,
              dash: [4 / z, 2 / z],
              listening: false,
            });
            guideLayer.add(marqueeRect);
            marqueeRef.current = {
              active: true,
              mode: 'marquee',
              tool: 'select',
              startX: sx,
              startY: sy,
              points: [],
              rectNode: marqueeRect,
              lineNode: null,
              shiftHeld: Boolean(evt?.shiftKey),
            };
            return;
          }
        }
        if (e.target === stage) {
          callbacksRef.current.onSelectIds([]);
        }
      }
    });

    stage.on('mousemove touchmove', () => {
      const m = marqueeRef.current;
      if (!m.active) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const z = callbacksRef.current.zoom;
      const cx = pos.x / z;
      const cy = pos.y / z;

      if (m.mode === 'draw' && m.lineNode) {
        const lastX = m.points[m.points.length - 2];
        const lastY = m.points[m.points.length - 1];
        if (Math.hypot(cx - lastX, cy - lastY) >= 1.5) {
          m.points.push(cx, cy);
          m.lineNode.points(m.points);
          guideLayer.batchDraw();
        }
        return;
      }

      if (m.mode === 'line' && m.lineNode) {
        m.points = [m.startX, m.startY, cx, cy];
        m.lineNode.points(m.points);
        guideLayer.batchDraw();
        if (m.tool === 'measure') {
          const distPt = Math.hypot(cx - m.startX, cy - m.startY);
          const dxPt = Math.abs(cx - m.startX);
          const dyPt = Math.abs(cy - m.startY);
          const u = callbacksRef.current.measureUnit;
          setLiveMeasureHint(
            `Dist: ${ptToUnit(distPt, u)} ${u} (ΔX ${ptToUnit(dxPt, u)} · ΔY ${ptToUnit(dyPt, u)})`
          );
        }
        return;
      }

      if (m.rectNode) {
        m.rectNode.setAttrs({
          x: Math.min(m.startX, cx),
          y: Math.min(m.startY, cy),
          width: Math.abs(cx - m.startX),
          height: Math.abs(cy - m.startY),
        });
        guideLayer.batchDraw();
      }
    });

    stage.on('mouseup touchend touchcancel', () => {
      const m = marqueeRef.current;
      if (!m.active) {
        if (isManipulatingRef.current) {
          isManipulatingRef.current = false;
          setIsManipulating(false);
        }
        return;
      }

      const finishReset = () => {
        m.rectNode?.destroy();
        m.lineNode?.destroy();
        marqueeRef.current = {
          active: false,
          mode: 'marquee',
          tool: 'select',
          startX: 0,
          startY: 0,
          points: [],
          rectNode: null,
          lineNode: null,
          shiftHeld: false,
        };
        guideLayer.batchDraw();
        isManipulatingRef.current = false;
        setIsManipulating(false);
        setLiveMeasureHint(null);
      };

      const createCb = callbacksRef.current.onCreateElement;
      const pNum = callbacksRef.current.currentPageNumber;

      if (m.mode === 'draw') {
        const pts = [...m.points];
        finishReset();
        if (createCb && pts.length >= 4) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let i = 0; i < pts.length; i += 2) {
            minX = Math.min(minX, pts[i]);
            maxX = Math.max(maxX, pts[i]);
            minY = Math.min(minY, pts[i + 1]);
            maxY = Math.max(maxY, pts[i + 1]);
          }
          const pad = 4;
          const bx = Math.max(0, minX - pad);
          const by = Math.max(0, minY - pad);
          const bw = Math.max(12, maxX - minX + pad * 2);
          const bh = Math.max(12, maxY - minY + pad * 2);
          const relPts = pts.map((val, idx) =>
            Number((idx % 2 === 0 ? val - bx : val - by).toFixed(2))
          );
          createCb({
            id: `el-draw-${Date.now().toString(36)}`,
            type: 'draw',
            pageNumber: pNum,
            x: Number(bx.toFixed(2)),
            y: Number(by.toFixed(2)),
            width: Number(bw.toFixed(2)),
            height: Number(bh.toFixed(2)),
            rotation: 0,
            text: 'Ink Stroke',
            fontFamily: 'Helvetica',
            fontSize: 10,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#111111',
            backgroundColor: 'transparent',
            borderColor: '#111111',
            borderWidth: 2,
            align: 'left',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            points: relPts,
            sourceOrigin: 'annotation',
            isUserAdded: true,
          });
        }
        return;
      }

      if (m.mode === 'line') {
        const [x1, y1, x2, y2] = m.points;
        finishReset();
        if (!createCb) return;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        const effLen = Math.max(36, len);
        const angle = len > 4 ? Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)) : 0;
        const u = callbacksRef.current.measureUnit;

        if (m.tool === 'measure') {
          const valLabel = `${ptToUnit(effLen, u)} ${u}`;
          createCb({
            id: `el-meas-${Date.now().toString(36)}`,
            type: 'measure',
            pageNumber: pNum,
            x: Number(x1.toFixed(2)),
            y: Number((y1 - 8).toFixed(2)),
            width: Number(effLen.toFixed(2)),
            height: 16,
            rotation: angle,
            text: valLabel,
            fontFamily: 'JetBrains Mono',
            fontSize: 9,
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#101010',
            backgroundColor: 'transparent',
            borderColor: '#101010',
            borderWidth: 1.2,
            align: 'center',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            measureUnit: u,
            sourceOrigin: 'annotation',
            isUserAdded: true,
          });
        } else {
          createCb({
            id: `el-${m.tool}-${Date.now().toString(36)}`,
            type: m.tool === 'arrow' ? 'shape' : 'line',
            shapeKind: m.tool === 'arrow' ? 'arrow' : 'line',
            pageNumber: pNum,
            x: Number(x1.toFixed(2)),
            y: Number((y1 - 6).toFixed(2)),
            width: Number(effLen.toFixed(2)),
            height: 12,
            rotation: angle,
            text: m.tool === 'arrow' ? 'Arrow' : 'Rule Line',
            fontFamily: 'Helvetica',
            fontSize: 10,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#111111',
            backgroundColor: 'transparent',
            borderColor: '#111111',
            borderWidth: 1.8,
            align: 'left',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            sourceOrigin: 'user_overlay',
            isUserAdded: true,
          });
        }
        return;
      }

      const rect = m.rectNode
        ? {
            x: m.rectNode.x(),
            y: m.rectNode.y(),
            width: m.rectNode.width(),
            height: m.rectNode.height(),
          }
        : null;
      const startPt = { x: m.startX, y: m.startY };
      const toolUsed = m.tool;
      const modeUsed = m.mode;
      const shiftHeld = m.shiftHeld;
      finishReset();

      if (modeUsed === 'box' && createCb) {
        const hasDrag = rect && (rect.width > 8 || rect.height > 8);
        const bx = Number((hasDrag ? rect!.x : startPt.x).toFixed(2));
        const by = Number((hasDrag ? rect!.y : startPt.y).toFixed(2));
        const bw = Number((hasDrag ? Math.max(16, rect!.width) : toolUsed === 'note' ? 26 : 140).toFixed(2));
        const bh = Number((hasDrag ? Math.max(12, rect!.height) : toolUsed === 'note' ? 26 : toolUsed === 'callout' ? 42 : 22).toFixed(2));
        const baseId = `el-${toolUsed}-${Date.now().toString(36)}`;

        if (toolUsed === 'redact') {
          createCb({
            id: baseId,
            type: 'redaction',
            pageNumber: pNum,
            x: bx,
            y: by,
            width: bw,
            height: bh,
            rotation: 0,
            text: 'REDACTION ZONE',
            fontFamily: 'Helvetica',
            fontSize: 9,
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#FFFFFF',
            backgroundColor: '#000000',
            borderColor: '#000000',
            borderWidth: 1,
            align: 'center',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            redactionMode: 'visual_mask',
            redactionApplied: false,
            sourceOrigin: 'redaction',
            isUserAdded: true,
          });
        } else if (
          toolUsed === 'highlight' ||
          toolUsed === 'underline_annot' ||
          toolUsed === 'strikeout_annot' ||
          toolUsed === 'note'
        ) {
          const kind =
            toolUsed === 'underline_annot'
              ? 'underline'
              : toolUsed === 'strikeout_annot'
              ? 'strikeout'
              : toolUsed;
          createCb({
            id: baseId,
            type: 'annotation',
            annotationKind: kind,
            pageNumber: pNum,
            x: bx,
            y: by,
            width: bw,
            height: bh,
            rotation: 0,
            text: kind === 'note' ? 'Comment Note' : `Annotation (${kind})`,
            commentText: kind === 'note' ? 'Review this section before final print.' : '',
            fontFamily: 'Helvetica',
            fontSize: 10,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: kind === 'highlight' ? '#A3A3A3' : '#111111',
            backgroundColor: kind === 'highlight' ? '#D4D4D4' : 'transparent',
            borderColor: '#111111',
            borderWidth: 1.4,
            align: 'left',
            opacity: kind === 'highlight' ? 0.35 : 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            sourceOrigin: 'annotation',
            isUserAdded: true,
          });
        } else if (toolUsed === 'callout') {
          createCb({
            id: baseId,
            type: 'callout',
            pageNumber: pNum,
            x: bx,
            y: by,
            width: Math.max(96, bw),
            height: Math.max(32, bh),
            rotation: 0,
            text: 'Callout Note',
            calloutTarget: { x: Math.max(0, bx - 28), y: by + bh + 24 },
            fontFamily: 'Helvetica',
            fontSize: 10,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#111111',
            backgroundColor: '#FFFFFF',
            borderColor: '#111111',
            borderWidth: 1.2,
            align: 'left',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            sourceOrigin: 'annotation',
            isUserAdded: true,
          });
        } else if (toolUsed === 'rect' || toolUsed === 'circle') {
          createCb({
            id: baseId,
            type: 'shape',
            shapeKind: toolUsed,
            pageNumber: pNum,
            x: bx,
            y: by,
            width: Math.max(24, bw),
            height: Math.max(20, bh),
            rotation: 0,
            text: '',
            fontFamily: 'Helvetica',
            fontSize: 10,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#111111',
            backgroundColor: 'transparent',
            borderColor: '#111111',
            borderWidth: 1.4,
            align: 'left',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            sourceOrigin: 'user_overlay',
            isUserAdded: true,
          });
        } else if (toolUsed === 'text') {
          createCb({
            id: baseId,
            type: 'text',
            pageNumber: pNum,
            x: bx,
            y: by,
            width: Math.max(120, bw),
            height: Math.max(22, bh),
            rotation: 0,
            text: 'New Text Block',
            fontFamily: 'Helvetica',
            fontSize: 12,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#111111',
            backgroundColor: 'transparent',
            align: 'left',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            sourceOrigin: 'user_overlay',
            isUserAdded: true,
          });
        }
        return;
      }

      if (rect && (rect.width > 4 || rect.height > 4)) {
        const hitIds = getElementsInMarquee(callbacksRef.current.elements, rect);
        if (shiftHeld) {
          const merged = Array.from(
            new Set([...callbacksRef.current.selectedIds, ...hitIds])
          );
          callbacksRef.current.onSelectIds(merged);
        } else {
          callbacksRef.current.onSelectIds(hitIds);
        }
      } else if (!shiftHeld) {
        callbacksRef.current.onSelectIds([]);
      }
    });

    const handleWindowBlur = () => cancelTransientStageGesture();
    const handleStageKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (marqueeRef.current.active) {
          cancelTransientStageGesture();
        }
        setContextMenu(null);
        setTableEditId(null);
        setTableCellSel(null);
        setInlineEditId(null);
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleStageKeyDown);

    stageRef.current = stage;
    bgLayerRef.current = bgLayer;
    gridLayerRef.current = gridLayer;
    elementsLayerRef.current = elementsLayer;
    guideLayerRef.current = guideLayer;
    cropLayerRef.current = cropLayer;
    transformerRef.current = tr;
    cropTransformerRef.current = cropTr;

    return () => {
      clearLongPress();
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleStageKeyDown);
      stage.destroy();
      stageRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update Transformer handle sizes dynamically when switching between touch/mouse viewports
  useEffect(() => {
    const tr = transformerRef.current;
    const cropTr = cropTransformerRef.current;
    if (tr) {
      tr.anchorSize(isTouchLargeHandles ? 16 : 7);
      tr.anchorCornerRadius(isTouchLargeHandles ? 4 : 0);
      tr.padding(isTouchLargeHandles ? 5 : 0);
      tr.rotateAnchorOffset(isTouchLargeHandles ? 30 : 22);
      tr.borderStrokeWidth(isTouchLargeHandles ? 2 : 1.5);
    }
    if (cropTr) {
      cropTr.anchorSize(isTouchLargeHandles ? 18 : 8);
      cropTr.anchorCornerRadius(isTouchLargeHandles ? 4 : 0);
    }
    elementsLayerRef.current?.batchDraw();
    cropLayerRef.current?.batchDraw();
  }, [isTouchLargeHandles]);

  // Resize & scale stage on zoom or page size changes
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.width(stageW);
    stage.height(stageH);
    stage.scale({ x: zoom, y: zoom });
    stage.batchDraw();
  }, [stageW, stageH, zoom]);

  // Render reference background & margins (in original PDF page space)
  useEffect(() => {
    const bgLayer = bgLayerRef.current;
    if (!bgLayer) return;
    bgLayer.destroyChildren();

    bgLayer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width: canvasW,
        height: canvasH,
        fill: pageConfig.backgroundColor || '#FFFFFF',
      })
    );

    if (bgImgObj) {
      bgLayer.add(
        new Konva.Image({
          x: 0,
          y: 0,
          width: canvasW,
          height: canvasH,
          image: bgImgObj,
        })
      );
    }

    // Subtle margin guide box
    bgLayer.add(
      new Konva.Rect({
        x: pageConfig.marginLeftPt,
        y: pageConfig.marginTopPt,
        width: Math.max(
          0,
          canvasW - pageConfig.marginLeftPt - pageConfig.marginRightPt
        ),
        height: Math.max(
          0,
          canvasH - pageConfig.marginTopPt - pageConfig.marginBottomPt
        ),
        stroke: 'rgba(64, 64, 64, 0.35)',
        strokeWidth: 0.8 / zoom,
        dash: [4 / zoom, 4 / zoom],
      })
    );

    bgLayer.batchDraw();
  }, [pageConfig, bgImgObj, canvasW, canvasH, zoom]);

  // Render grid lines
  useEffect(() => {
    const gridLayer = gridLayerRef.current;
    if (!gridLayer) return;
    gridLayer.destroyChildren();

    if (showGrid && gridSizePt >= 4) {
      for (let x = gridSizePt; x < canvasW; x += gridSizePt) {
        gridLayer.add(
          new Konva.Line({
            points: [x, 0, x, canvasH],
            stroke: 'rgba(115, 115, 115, 0.22)',
            strokeWidth: 0.6 / zoom,
          })
        );
      }
      for (let y = gridSizePt; y < canvasH; y += gridSizePt) {
        gridLayer.add(
          new Konva.Line({
            points: [0, y, canvasW, y],
            stroke: 'rgba(115, 115, 115, 0.22)',
            strokeWidth: 0.6 / zoom,
          })
        );
      }
    }
    gridLayer.batchDraw();
  }, [showGrid, gridSizePt, canvasW, canvasH, zoom]);

  // Render elements layer (only rebuilds when document geometry/content/images change, NOT on selection or zoom)
  useEffect(() => {
    const layer = elementsLayerRef.current;
    const tr = transformerRef.current;
    const guideLayer = guideLayerRef.current;
    if (!layer || !tr || !guideLayer) return;

    const currentZoom = callbacksRef.current.zoom || 1;
    const isPreviewCurr = callbacksRef.current.interactionMode === 'preview';
    const currTool = callbacksRef.current.activeTool;
    const toolAllowsDrag =
      (currTool === 'select' || currTool === 'marquee' || currTool === 'inspect') &&
      !callbacksRef.current.stylePainterActive;

    // Remove all children except transformer
    layer.getChildren().forEach((child) => {
      if (child !== tr) {
        child.destroy();
      }
    });
    nodeMapRef.current.clear();
    highlightRectRef.current = null;

    const drawGuides = (activeEl: DocumentElement, nx: number, ny: number) => {
      guideLayer.destroyChildren();
      const others = callbacksRef.current.elements.filter(
        (o) =>
          o.id !== activeEl.id &&
          !(
            callbacksRef.current.selectedIds.length > 1 &&
            callbacksRef.current.selectedIds.includes(o.id)
          )
      );
      const res = computeSmartSnapAndGuides(
        {
          x: nx,
          y: ny,
          width: activeEl.width,
          height: activeEl.height,
        },
        others,
        {
          canvasW: callbacksRef.current.canvasW,
          canvasH: callbacksRef.current.canvasH,
          snapToGrid: callbacksRef.current.snapToGrid,
          gridSizePt: callbacksRef.current.gridSizePt,
          snapToObjects: callbacksRef.current.snapToObjects,
          showAlignmentGuides: callbacksRef.current.showAlignmentGuides,
          snapThresholdPt: callbacksRef.current.snapThresholdPt,
        }
      );

      for (const g of res.guides) {
        if (g.orientation === 'v') {
          guideLayer.add(
            new Konva.Line({
              points: [g.pos, g.start, g.pos, g.end],
              stroke: g.kind === 'spacing' ? '#404040' : '#101010',
              strokeWidth: 0.9 / callbacksRef.current.zoom,
              dash: [3 / callbacksRef.current.zoom, 3 / callbacksRef.current.zoom],
            })
          );
        } else {
          guideLayer.add(
            new Konva.Line({
              points: [g.start, g.pos, g.end, g.pos],
              stroke: g.kind === 'spacing' ? '#404040' : '#101010',
              strokeWidth: 0.9 / callbacksRef.current.zoom,
              dash: g.kind === 'spacing' ? undefined : [3 / callbacksRef.current.zoom, 3 / callbacksRef.current.zoom],
            })
          );
          if (g.kind === 'spacing' && g.label) {
            guideLayer.add(
              new Konva.Text({
                x: (g.start + g.end) / 2 - 14,
                y: g.pos - 12 / callbacksRef.current.zoom,
                text: g.label,
                fontSize: 9 / callbacksRef.current.zoom,
                fill: '#101010',
                fontStyle: 'bold',
              })
            );
          }
        }
      }

      guideLayer.batchDraw();
      return { x: res.x, y: res.y };
    };

    for (const el of elements) {
      if (el.eraseOriginal && el.sourceOriginalRect) {
        const r = el.sourceOriginalRect;
        layer.add(
          new Konva.Rect({
            x: r.x - 1,
            y: r.y - 1,
            width: r.width + 2,
            height: r.height + 2,
            fill:
              pageConfig.backgroundColor === 'transparent'
                ? '#FFFFFF'
                : pageConfig.backgroundColor,
            listening: false,
          })
        );
      }

      if (!el.visible) continue;

      const group = new Konva.Group({
        id: el.id,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation || 0,
        draggable: !isPreviewCurr && !el.locked && toolAllowsDrag,
        opacity: el.opacity ?? 1,
      });

      const isSelected = !isPreviewCurr && callbacksRef.current.selectedIds.includes(el.id);
      const showBoxOutline =
        !isPreviewCurr &&
        (isSelected ||
          el.needsReview ||
          el.type === 'border' ||
          el.type === 'repeated_block');

      const isModifiedOrAdded = Boolean(el.isUserAdded || el.eraseOriginal);

      if (el.type === 'redaction') {
        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            fill: '#000000',
            stroke: isPreviewCurr
              ? 'transparent'
              : el.redactionApplied
              ? '#525252'
              : '#FFFFFF',
            strokeWidth: 1 / currentZoom,
            dash: !isPreviewCurr && !el.redactionApplied ? [4 / currentZoom, 2 / currentZoom] : undefined,
          })
        );
        if (!isPreviewCurr) {
          group.add(
            new Konva.Text({
              width: el.width,
              height: el.height,
              text: el.redactionApplied ? 'REDACTED' : 'MARKED REDACT',
              fontSize: Math.max(7, Math.min(10, el.height * 0.55)),
              fontStyle: 'bold',
              fill: '#FFFFFF',
              align: 'center',
              verticalAlign: 'middle',
            })
          );
        }
      } else if (el.type === 'draw' && el.points && el.points.length >= 4) {
        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            fill: 'rgba(0,0,0,0.001)',
          })
        );
        group.add(
          new Konva.Line({
            points: el.points,
            stroke: el.color || '#111111',
            strokeWidth: el.borderWidth ?? 2,
            lineCap: 'round',
            lineJoin: 'round',
            tension: 0.35,
            hitStrokeWidth: isTouchLargeHandles ? 18 : 8,
          })
        );
      } else if (el.type === 'measure') {
        const midY = el.height / 2;
        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            fill: 'rgba(0,0,0,0.001)',
          })
        );
        group.add(
          new Konva.Line({
            points: [0, midY, el.width, midY],
            stroke: el.color || '#101010',
            strokeWidth: el.borderWidth ?? 1.2,
          })
        );
        group.add(
          new Konva.Line({
            points: [0, midY - 4, 0, midY + 4],
            stroke: el.color || '#101010',
            strokeWidth: 1.2,
          })
        );
        group.add(
          new Konva.Line({
            points: [el.width, midY - 4, el.width, midY + 4],
            stroke: el.color || '#101010',
            strokeWidth: 1.2,
          })
        );
        group.add(
          new Konva.Text({
            x: 0,
            y: midY - 12,
            width: Math.max(40, el.width),
            text: el.text || `${ptToUnit(el.width, measureUnit)} ${measureUnit}`,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 8.5,
            fontStyle: 'bold',
            fill: el.color || '#101010',
            align: 'center',
          })
        );
      } else if (el.type === 'callout') {
        if (el.calloutTarget) {
          group.add(
            new Konva.Line({
              points: [
                el.width / 2,
                el.height,
                el.calloutTarget.x - el.x,
                el.calloutTarget.y - el.y,
              ],
              stroke: el.borderColor || el.color || '#111111',
              strokeWidth: 1.2,
            })
          );
          group.add(
            new Konva.Circle({
              x: el.calloutTarget.x - el.x,
              y: el.calloutTarget.y - el.y,
              radius: 3,
              fill: el.borderColor || el.color || '#111111',
            })
          );
        }
        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            fill: el.backgroundColor === 'transparent' ? '#FFFFFF' : el.backgroundColor,
            stroke: el.borderColor || el.color || '#111111',
            strokeWidth: el.borderWidth ?? 1.2,
            cornerRadius: 4,
          })
        );
        group.add(
          new Konva.Text({
            width: el.width,
            height: el.height,
            text: el.text,
            fontFamily: mapFontToCanvasCss(el.fontFamily),
            fontSize: el.fontSize || 10,
            fill: el.color || '#111111',
            padding: 4,
            verticalAlign: 'middle',
          })
        );
      } else if (el.type === 'stamp') {
        const col = el.color || '#111111';
        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            stroke: col,
            strokeWidth: el.borderWidth ?? 2,
            cornerRadius: 4,
          })
        );
        group.add(
          new Konva.Rect({
            x: 3,
            y: 3,
            width: Math.max(4, el.width - 6),
            height: Math.max(4, el.height - 6),
            stroke: col,
            strokeWidth: 0.8,
            cornerRadius: 2,
          })
        );
        group.add(
          new Konva.Text({
            width: el.width,
            height: el.stampDate ? el.height * 0.65 : el.height,
            text: el.stampText || el.text || 'APPROVED',
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: Math.max(8, Math.min(el.fontSize || 14, el.height * 0.52)),
            fontStyle: 'bold',
            fill: col,
            align: 'center',
            verticalAlign: 'middle',
          })
        );
        if (el.stampDate) {
          group.add(
            new Konva.Text({
              y: el.height * 0.6,
              width: el.width,
              height: el.height * 0.35,
              text: el.stampDate,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 7.5,
              fontStyle: 'bold',
              fill: col,
              align: 'center',
              verticalAlign: 'middle',
            })
          );
        }
      } else if (el.type === 'annotation') {
        const kind = el.annotationKind || 'highlight';
        const col = el.color || '#111111';
        if (kind === 'highlight') {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              fill: el.backgroundColor !== 'transparent' ? el.backgroundColor : col,
              opacity: Math.min(0.45, el.opacity ?? 0.32),
            })
          );
        } else if (kind === 'underline' || kind === 'strikeout') {
          const lineY = kind === 'underline' ? el.height - 2 : el.height / 2;
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              fill: 'rgba(0,0,0,0.001)',
            })
          );
          group.add(
            new Konva.Line({
              points: [0, lineY, el.width, lineY],
              stroke: col,
              strokeWidth: el.borderWidth ?? 1.6,
            })
          );
        } else if (kind === 'note') {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              fill: '#F5F5F5',
              stroke: col,
              strokeWidth: 1.2,
              cornerRadius: 4,
            })
          );
          group.add(
            new Konva.Text({
              width: el.width,
              height: el.height,
              text: 'NOTE',
              fontSize: Math.max(6, Math.min(8, el.width * 0.25)),
              fontStyle: 'bold',
              fill: col,
              align: 'center',
              verticalAlign: 'middle',
            })
          );
        } else if (kind === 'ellipse') {
          group.add(
            new Konva.Ellipse({
              x: el.width / 2,
              y: el.height / 2,
              radiusX: el.width / 2,
              radiusY: el.height / 2,
              stroke: col,
              strokeWidth: el.borderWidth ?? 1.5,
            })
          );
        } else {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              stroke: col,
              strokeWidth: el.borderWidth ?? 1.5,
            })
          );
        }
      } else if (el.type === 'shape' || el.type === 'border') {
        const strokeColor = isModifiedOrAdded
          ? el.borderColor || el.color || '#1E293B'
          : isSelected
          ? '#101010'
          : isPreviewCurr
          ? 'transparent'
          : 'rgba(16, 16, 16, 0.25)';
        const strokeW = isModifiedOrAdded ? el.borderWidth ?? 1.2 : 0.75 / currentZoom;
        const dashArr =
          isModifiedOrAdded && el.dashArray?.length ? el.dashArray : undefined;
        const fillCol =
          isModifiedOrAdded && el.backgroundColor !== 'transparent'
            ? el.backgroundColor
            : undefined;

        if (
          el.shapeKind === 'circle' ||
          el.objectSubtype === 'circle' ||
          el.objectSubtype === 'ellipse'
        ) {
          group.add(
            new Konva.Ellipse({
              x: el.width / 2,
              y: el.height / 2,
              radiusX: el.width / 2,
              radiusY: el.height / 2,
              fill: fillCol,
              stroke: strokeColor,
              strokeWidth: strokeW,
              dash: dashArr,
              hitStrokeWidth: isTouchLargeHandles ? 16 : 6,
            })
          );
        } else if (el.shapeKind === 'arrow') {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: Math.max(isTouchLargeHandles ? 20 : 12, el.height),
              fill: 'rgba(0,0,0,0.001)',
            })
          );
          group.add(
            new Konva.Arrow({
              points: [0, el.height / 2, el.width, el.height / 2],
              pointerLength: Math.min(12, Math.max(6, el.width * 0.14)),
              pointerWidth: Math.min(10, Math.max(5, el.width * 0.12)),
              fill: strokeColor,
              stroke: strokeColor,
              strokeWidth: strokeW,
              dash: dashArr,
              hitStrokeWidth: isTouchLargeHandles ? 18 : 8,
            })
          );
        } else if (
          el.shapeKind === 'polygon' ||
          el.objectSubtype === 'polygon' ||
          el.objectSubtype === 'freeform_path'
        ) {
          let relPts: number[] | null =
            el.points && el.points.length >= 4 ? el.points : null;
          if (!relPts && el.vectorPath?.points && el.vectorPath.points.length >= 4) {
            relPts = [];
            for (let pi = 0; pi < el.vectorPath.points.length; pi += 2) {
              relPts.push(
                el.vectorPath.points[pi] - el.x,
                el.vectorPath.points[pi + 1] - el.y
              );
            }
          }
          if (relPts && relPts.length >= 4) {
            group.add(
              new Konva.Line({
                points: relPts,
                closed: el.vectorPath?.isClosed !== false,
                fill: fillCol,
                stroke: strokeColor,
                strokeWidth: strokeW,
                dash: dashArr,
                hitStrokeWidth: isTouchLargeHandles ? 16 : 6,
              })
            );
          } else {
            group.add(
              new Konva.Rect({
                width: el.width,
                height: el.height,
                cornerRadius: el.cornerRadiusPt || 0,
                fill: fillCol,
                stroke: strokeColor,
                strokeWidth: strokeW,
                dash: dashArr,
                hitStrokeWidth: isTouchLargeHandles ? 16 : 6,
              })
            );
          }
        } else {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              cornerRadius: el.cornerRadiusPt || 0,
              fill: fillCol,
              stroke: strokeColor,
              strokeWidth: strokeW,
              dash: dashArr,
              hitStrokeWidth: isTouchLargeHandles ? 16 : 6,
            })
          );
        }
      } else if (el.type === 'line') {
        const hitH = Math.max(isTouchLargeHandles ? 20 : 8, el.height);
        group.add(
          new Konva.Rect({
            y: el.height / 2 - hitH / 2,
            width: Math.max(8, el.width),
            height: hitH,
            fill: 'rgba(0,0,0,0.001)',
          })
        );
        let linePts = [0, el.height / 2, el.width, el.height / 2];
        if (el.points && el.points.length >= 4) {
          linePts = [el.points[0], el.points[1], el.points[2], el.points[3]];
        } else if (el.vectorPath?.points && el.vectorPath.points.length >= 4) {
          linePts = [
            el.vectorPath.points[0] - el.x,
            el.vectorPath.points[1] - el.y,
            el.vectorPath.points[2] - el.x,
            el.vectorPath.points[3] - el.y,
          ];
        }
        group.add(
          new Konva.Line({
            points: linePts,
            stroke: isModifiedOrAdded
              ? el.color || '#1E293B'
              : isSelected
              ? '#101010'
              : isPreviewCurr
              ? 'transparent'
              : 'rgba(16, 16, 16, 0.28)',
            strokeWidth: isModifiedOrAdded ? el.borderWidth ?? 1.5 : 0.8 / currentZoom,
            dash:
              isModifiedOrAdded && el.dashArray?.length ? el.dashArray : undefined,
            hitStrokeWidth: isTouchLargeHandles ? 18 : 6,
          })
        );
      } else if (el.type === 'image' || el.type === 'signature') {
        const imgEntry = elementImgs[el.id];
        if (imgEntry?.img) {
          const imgNode = new Konva.Image({
            width: el.width,
            height: el.height,
            image: imgEntry.img,
            crop: el.imageCropRect
              ? {
                  x: el.imageCropRect.x,
                  y: el.imageCropRect.y,
                  width: Math.max(2, el.imageCropRect.width),
                  height: Math.max(2, el.imageCropRect.height),
                }
              : undefined,
          });
          if (el.maskShape === 'circle') {
            group.clipFunc((ctx) => {
              ctx.beginPath();
              ctx.ellipse(
                el.width / 2,
                el.height / 2,
                el.width / 2,
                el.height / 2,
                0,
                0,
                Math.PI * 2
              );
            });
          } else if (el.maskShape === 'rounded') {
            const rad = Math.min(el.width, el.height) * 0.14;
            group.clipFunc((ctx) => {
              ctx.beginPath();
              ctx.roundRect(0, 0, el.width, el.height, rad);
            });
          }
          group.add(imgNode);
        } else {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              fill: 'rgba(16, 16, 16, 0.04)',
              stroke: 'rgba(16, 16, 16, 0.4)',
              strokeWidth: 0.8 / currentZoom,
              dash: [4, 2],
            })
          );
        }
      } else if (el.type === 'table' && el.tableData) {
        const {
          rows,
          borderColor,
          headerBgColor,
          headerRow,
          cellPadding,
          colWidthsPt,
          rowHeightsPt,
          mergedCells,
          hasBorders,
          borderWidthPt,
        } = el.tableData;
        const rCount = Math.max(1, rows.length);
        const cCount = Math.max(1, rows[0]?.length || 1);

        const rawColW =
          colWidthsPt && colWidthsPt.length === cCount
            ? colWidthsPt
            : Array(cCount).fill(el.width / cCount);
        const rawColSum = rawColW.reduce((s, v) => s + Math.max(4, v), 0) || el.width;
        const colWidths = rawColW.map((v) => (Math.max(4, v) / rawColSum) * el.width);

        const rawRowH =
          rowHeightsPt && rowHeightsPt.length === rCount
            ? rowHeightsPt
            : Array(rCount).fill(el.height / rCount);
        const rawRowSum = rawRowH.reduce((s, v) => s + Math.max(4, v), 0) || el.height;
        const rowHeights = rawRowH.map((v) => (Math.max(4, v) / rawRowSum) * el.height);

        const colX: number[] = [0];
        for (let c = 0; c < cCount; c++) colX.push(colX[c] + colWidths[c]);
        const rowY: number[] = [0];
        for (let r = 0; r < rCount; r++) rowY.push(rowY[r] + rowHeights[r]);

        const covered = new Set<string>();
        const anchorMap = new Map<string, { rowSpan: number; colSpan: number }>();
        for (const m of mergedCells || []) {
          anchorMap.set(`${m.row}:${m.col}`, {
            rowSpan: Math.max(1, m.rowSpan),
            colSpan: Math.max(1, m.colSpan),
          });
          for (let rr = m.row; rr < Math.min(rCount, m.row + m.rowSpan); rr++) {
            for (let cc = m.col; cc < Math.min(cCount, m.col + m.colSpan); cc++) {
              if (rr !== m.row || cc !== m.col) covered.add(`${rr}:${cc}`);
            }
          }
        }

        const pad = cellPadding ?? 4;
        const showCellStroke = hasBorders !== false;

        for (let r = 0; r < rCount; r++) {
          for (let c = 0; c < cCount; c++) {
            const key = `${r}:${c}`;
            if (covered.has(key)) continue;
            const span = anchorMap.get(key) || { rowSpan: 1, colSpan: 1 };
            const rEnd = Math.min(rCount, r + span.rowSpan);
            const cEnd = Math.min(cCount, c + span.colSpan);
            const cellX = colX[c];
            const cellY = rowY[r];
            const cellW = colX[cEnd] - cellX;
            const cellH = rowY[rEnd] - cellY;
            const cellText = String(rows[r]?.[c] ?? '');

            group.add(
              new Konva.Rect({
                x: cellX,
                y: cellY,
                width: cellW,
                height: cellH,
                fill:
                  isModifiedOrAdded
                    ? headerRow && r === 0
                      ? headerBgColor || '#F1F5F9'
                      : '#FFFFFF'
                    : headerRow && r === 0 && isSelected
                    ? 'rgba(241, 245, 249, 0.55)'
                    : 'rgba(255, 255, 255, 0.001)',
                stroke: showCellStroke
                  ? borderColor || '#CBD5E1'
                  : isSelected
                  ? 'rgba(37, 99, 235, 0.35)'
                  : 'transparent',
                strokeWidth: showCellStroke
                  ? borderWidthPt ?? 0.8
                  : isSelected
                  ? 0.5
                  : 0,
              })
            );
            if (isModifiedOrAdded || isSelected) {
              group.add(
                new Konva.Text({
                  x: cellX + pad,
                  y: cellY + pad,
                  width: Math.max(8, cellW - pad * 2),
                  height: Math.max(8, cellH - pad * 2),
                  text: cellText,
                  fontFamily: mapFontToCanvasCss(el.fontFamily),
                  fontSize: Math.min(el.fontSize || 9.5, Math.max(6.5, cellH * 0.55)),
                  fontStyle: headerRow && r === 0 ? 'bold' : 'normal',
                  align: el.align || 'left',
                  fill: el.color || '#111827',
                  verticalAlign: 'middle',
                  wrap: 'word',
                })
              );
            }
          }
        }
      } else if (el.type === 'barcode' || el.type === 'qr_code') {
        const format: BarcodeFormat =
          el.barcodeFormat || (el.type === 'qr_code' ? 'qr' : 'code128');
        const payload = el.barcodeValue || el.text || '';
        const encoded = encodeBarcode(format, payload, el.qrErrorCorrection || 'M');
        const qz = Math.max(0, el.barcodeQuietZonePt ?? 6);
        const bgFill =
          el.backgroundColor && el.backgroundColor !== 'transparent'
            ? el.backgroundColor
            : '#FFFFFF';
        const fgColor = el.color || '#000000';

        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            fill: bgFill,
            stroke: isPreviewCurr
              ? 'transparent'
              : encoded.ok
              ? 'rgba(16, 16, 16, 0.32)'
              : '#DC2626',
            strokeWidth: (encoded.ok ? 0.7 : 1.3) / currentZoom,
            dash: !isPreviewCurr && !encoded.ok ? [4 / currentZoom, 2 / currentZoom] : undefined,
          })
        );

        if (encoded.ok) {
          group.add(
            new Konva.Shape({
              width: el.width,
              height: el.height,
              listening: false,
              sceneFunc: (ctx, shape) => {
                const innerW = Math.max(4, el.width - qz * 2);
                const innerH = Math.max(4, el.height - qz * 2);
                ctx.fillStyle = fgColor;

                if (encoded.matrix) {
                  const n = encoded.matrix.size;
                  const dim = Math.min(innerW, innerH);
                  const cell = dim / n;
                  const startX = qz + (innerW - dim) / 2;
                  const startY = qz + (innerH - dim) / 2;
                  for (let r = 0; r < n; r++) {
                    let c = 0;
                    while (c < n) {
                      if (encoded.matrix.rows[r][c] === 1) {
                        let run = 1;
                        while (c + run < n && encoded.matrix.rows[r][c + run] === 1) run++;
                        ctx.fillRect(
                          startX + c * cell,
                          startY + r * cell,
                          run * cell + 0.05,
                          cell + 0.05
                        );
                        c += run;
                      } else {
                        c++;
                      }
                    }
                  }
                } else if (encoded.linearModules && encoded.totalModules) {
                  const showText = el.barcodeIncludeText !== false && innerH >= 20;
                  const textBandH = showText ? Math.min(11, Math.max(7, innerH * 0.24)) : 0;
                  const barH = Math.max(4, innerH - textBandH);
                  const modW = innerW / encoded.totalModules;
                  const mods = encoded.linearModules;
                  let i = 0;
                  while (i < mods.length) {
                    if (mods[i] === 1) {
                      let run = 1;
                      while (i + run < mods.length && mods[i + run] === 1) run++;
                      ctx.fillRect(qz + i * modW, qz, run * modW, barH);
                      i += run;
                    } else {
                      i++;
                    }
                  }
                }
                ctx.fillStrokeShape(shape);
              },
            })
          );

          if (!encoded.matrix && el.barcodeIncludeText !== false && el.height - qz * 2 >= 20) {
            const innerW = Math.max(4, el.width - qz * 2);
            const innerH = Math.max(4, el.height - qz * 2);
            const textBandH = Math.min(11, Math.max(7, innerH * 0.24));
            group.add(
              new Konva.Text({
                x: qz,
                y: qz + innerH - textBandH,
                width: innerW,
                height: textBandH,
                text: encoded.displayValue,
                fontFamily: 'JetBrains Mono, Courier, monospace',
                fontSize: Math.max(5.5, Math.min(9.5, textBandH * 0.82)),
                fill: fgColor,
                align: 'center',
                verticalAlign: 'middle',
                listening: false,
              })
            );
          }
        } else {
          group.add(
            new Konva.Text({
              x: 4,
              y: 4,
              width: Math.max(12, el.width - 8),
              height: Math.max(12, el.height - 8),
              text: encoded.error || 'Invalid Barcode',
              fontSize: 8,
              fill: '#DC2626',
              align: 'center',
              verticalAlign: 'middle',
              listening: false,
            })
          );
        }
      } else {
        const shouldDrawFillAndText = Boolean(
          el.isUserAdded || el.eraseOriginal
        );
        const typo = shouldDrawFillAndText ? computeTypographyLayout(el) : null;
        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            fill:
              el.backgroundColor && el.backgroundColor !== 'transparent'
                ? el.backgroundColor
                : isPreviewCurr
                ? 'transparent'
                : 'rgba(16, 16, 16, 0.015)',
            stroke: isPreviewCurr
              ? 'transparent'
              : el.needsReview
              ? '#D97706'
              : showBoxOutline
              ? 'rgba(16, 16, 16, 0.45)'
              : 'rgba(115, 115, 115, 0.25)',
            strokeWidth: (el.needsReview ? 1.2 : 0.7) / currentZoom,
            dash: !isPreviewCurr && el.needsReview ? [3 / currentZoom, 2 / currentZoom] : undefined,
          })
        );

        if (shouldDrawFillAndText && typo) {
          const textDeco = [
            el.underline ? 'underline' : '',
            el.strikethrough ? 'line-through' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const paddingPt = Math.max(0, el.paddingPt ?? 1);
          const fontStyleStr =
            `${el.fontWeight === 'bold' ? 'bold' : ''} ${
              el.fontStyle === 'italic' ? 'italic' : ''
            }`.trim() || 'normal';
          const textClipGroup = new Konva.Group({
            clipX: 0,
            clipY: 0,
            clipWidth: el.width,
            clipHeight: el.height,
            listening: false,
          });
          let cursorY = typo.verticalOffsetPt;
          typo.lines.forEach((lineObj, idx) => {
            if (idx > 0 && lineObj.paragraphIndex !== typo.lines[idx - 1].paragraphIndex) {
              cursorY += typo.paragraphSpacingPt;
            }
            textClipGroup.add(
              new Konva.Text({
                x: paddingPt,
                y: cursorY - (el.baselineOffset || 0),
                width: typo.contentBoxWidthPt,
                height: typo.lineHeightPt * 1.15,
                text: lineObj.text,
                fontFamily: mapFontToCanvasCss(el.fontFamily),
                fontSize: typo.effectiveFontSize,
                fontStyle: fontStyleStr,
                textDecoration: textDeco || undefined,
                letterSpacing: el.letterSpacing ?? 0,
                fill: el.color || '#111827',
                align: el.align || 'left',
                wrap: 'none',
                listening: false,
              })
            );
            cursorY += typo.lineHeightPt;
          });
          group.add(textClipGroup);
          if (!isPreviewCurr && typo.isClipped) {
            group.add(
              new Konva.Circle({
                x: el.width - 3 / currentZoom,
                y: el.height - 3 / currentZoom,
                radius: 2.5 / currentZoom,
                fill: '#DC2626',
                listening: false,
              })
            );
          }
        }
      }

      // Click / single-finger tap selection + Style Painter + long-press trigger
      group.on('mousedown touchstart', (e) => {
        if (callbacksRef.current.interactionMode === 'preview') return;

        const evtType = e.evt?.type || '';
        if (evtType === 'touchstart') {
          lastTouchEventAtRef.current = Date.now();
          const te = e.evt as unknown as TouchEvent;
          if (te.touches && te.touches.length >= 2) {
            clearLongPress();
            return;
          }
        } else if (evtType === 'mousedown' && Date.now() - lastTouchEventAtRef.current < 450) {
          return;
        }

        const activeT = callbacksRef.current.activeTool;
        if (
          callbacksRef.current.stylePainterActive ||
          activeT === 'style_painter'
        ) {
          e.cancelBubble = true;
          callbacksRef.current.onStylePaintTarget?.(el.id);
          return;
        }
        // Let pointer creation tools draw across existing elements instead of selecting background boxes
        if (
          activeT !== 'select' &&
          activeT !== 'marquee' &&
          activeT !== 'inspect'
        ) {
          return;
        }

        e.cancelBubble = true;
        setContextMenu(null);

        const touchEvt = e.evt as TouchEvent;
        if (touchEvt.touches && touchEvt.touches.length === 1) {
          const t = touchEvt.touches[0];
          clearLongPress();
          longPressStartPosRef.current = { x: t.clientX, y: t.clientY };
          longPressTimerRef.current = window.setTimeout(() => {
            setContextMenu({
              elementId: el.id,
              x: t.clientX,
              y: t.clientY,
            });
          }, 480);
        }

        const evt = e.evt as MouseEvent;
        const curr = callbacksRef.current.selectedIds;
        if (evt.shiftKey) {
          pendingNarrowIdRef.current = null;
          if (curr.includes(el.id)) {
            callbacksRef.current.onSelectIds(curr.filter((i) => i !== el.id));
          } else {
            callbacksRef.current.onSelectIds([...curr, el.id]);
          }
        } else if (curr.length > 1 && curr.includes(el.id) && !el.groupId) {
          // Preserve multi-selection on pointer down so user can drag multiple selected items cleanly;
          // narrow to single item only on clean click/tap without dragging.
          pendingNarrowIdRef.current = el.id;
        } else {
          pendingNarrowIdRef.current = null;
          if (el.groupId) {
            const grouped = callbacksRef.current.elements
              .filter((x) => x.groupId === el.groupId)
              .map((x) => x.id);
            callbacksRef.current.onSelectIds(grouped);
          } else if (!(curr.length === 1 && curr[0] === el.id)) {
            callbacksRef.current.onSelectIds([el.id]);
          }
        }
      });

      group.on('click tap', (e) => {
        if (pendingNarrowIdRef.current === el.id) {
          pendingNarrowIdRef.current = null;
          const evt = e.evt as MouseEvent;
          if (!evt?.shiftKey) {
            callbacksRef.current.onSelectIds([el.id]);
          }
        }
      });

      group.on('touchmove', (e) => {
        const touchEvt = e.evt as TouchEvent;
        const start = longPressStartPosRef.current;
        if (start && touchEvt.touches?.[0]) {
          const dx = touchEvt.touches[0].clientX - start.x;
          const dy = touchEvt.touches[0].clientY - start.y;
          if (Math.hypot(dx, dy) > 8) {
            clearLongPress();
          }
        }
      });

      group.on('touchend touchcancel', () => {
        clearLongPress();
      });

      group.on('contextmenu', (e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        const evt = e.evt as MouseEvent;
        callbacksRef.current.onSelectIds([el.id]);
        setContextMenu({
          elementId: el.id,
          x: evt.clientX,
          y: evt.clientY,
        });
      });

      // Double-click / double-tap to inline edit text or table
      group.on('dblclick dbltap', (e) => {
        if (callbacksRef.current.interactionMode === 'preview') return;
        e.cancelBubble = true;
        clearLongPress();
        if (el.locked) return;
        if (el.type === 'table') {
          setTableEditId(el.id);
        } else if (
          el.type !== 'image' &&
          el.type !== 'line' &&
          el.type !== 'shape'
        ) {
          setInlineEditId(el.id);
          setInlineText(el.text);
        }
      });

      group.on('dragstart', () => {
        clearLongPress();
        pendingNarrowIdRef.current = null;
        isManipulatingRef.current = true;
        setIsManipulating(true);
      });

      group.on('dragmove', () => {
        const guided = drawGuides(el, group.x(), group.y());
        group.x(guided.x);
        group.y(guided.y);
      });

      group.on('dragend', () => {
        isManipulatingRef.current = false;
        setIsManipulating(false);
        guideLayer.destroyChildren();
        guideLayer.batchDraw();
        const nx = Number(group.x().toFixed(2));
        const ny = Number(group.y().toFixed(2));
        const dx = nx - el.x;
        const dy = ny - el.y;

        const currSel = callbacksRef.current.selectedIds;
        if (el.groupId) {
          const members = callbacksRef.current.elements.filter(
            (m) => m.groupId === el.groupId && !m.locked
          );
          callbacksRef.current.onUpdateElementsBatch(
            members.map((m) => ({
              id: m.id,
              patch: {
                x: Number((m.x + dx).toFixed(2)),
                y: Number((m.y + dy).toFixed(2)),
                eraseOriginal: m.isUserAdded ? false : true,
              },
            }))
          );
        } else if (currSel.length > 1 && currSel.includes(el.id)) {
          const members = callbacksRef.current.elements.filter(
            (m) => currSel.includes(m.id) && !m.locked
          );
          callbacksRef.current.onUpdateElementsBatch(
            members.map((m) => ({
              id: m.id,
              patch: {
                x: Number((m.x + dx).toFixed(2)),
                y: Number((m.y + dy).toFixed(2)),
                eraseOriginal: m.isUserAdded ? false : true,
              },
            }))
          );
        } else {
          callbacksRef.current.onUpdateElement(el.id, {
            x: nx,
            y: ny,
            eraseOriginal: el.isUserAdded ? false : true,
          });
        }
      });

      layer.add(group);
      nodeMapRef.current.set(el.id, group);
    }

    // Re-attach transformer after element build
    const selNow = callbacksRef.current.selectedIds;
    const selectedNodes =
      callbacksRef.current.cropMode || isPreviewCurr
        ? []
        : selNow
            .map((id) => nodeMapRef.current.get(id))
            .filter((n): n is Konva.Node => Boolean(n));
    const lockRatio = elements.some(
      (el) => selNow.includes(el.id) && Boolean(el.lockAspectRatio)
    );
    tr.keepRatio(lockRatio);
    tr.nodes(selectedNodes);
    tr.moveToTop();
    layer.listening(!isPreviewCurr);
    layer.batchDraw();
  }, [
    elements,
    elementImgs,
    pageConfig.backgroundColor,
    measureUnit,
  ]);

  // Lightweight selection, highlight, tool-draggable & mode sync WITHOUT destroying Konva nodes mid-drag
  useEffect(() => {
    const layer = elementsLayerRef.current;
    const tr = transformerRef.current;
    if (!layer || !tr) return;

    const isPreview = interactionMode === 'preview';
    const toolAllowsDrag =
      (activeTool === 'select' || activeTool === 'marquee' || activeTool === 'inspect') &&
      !stylePainterActive;

    layer.listening(!isPreview);

    for (const el of elements) {
      const node = nodeMapRef.current.get(el.id);
      if (node) {
        node.draggable(!isPreview && !el.locked && toolAllowsDrag);
      }
    }

    const selectedNodes =
      cropMode || isPreview
        ? []
        : selectedIds
            .map((id) => nodeMapRef.current.get(id))
            .filter((n): n is Konva.Node => Boolean(n));
    const lockRatio = elements.some(
      (el) => selectedIds.includes(el.id) && Boolean(el.lockAspectRatio)
    );
    tr.keepRatio(lockRatio);
    tr.nodes(selectedNodes);
    tr.moveToTop();

    // Update/remove highlight ring on elements layer without touching element groups
    if (highlightRectRef.current) {
      highlightRectRef.current.destroy();
      highlightRectRef.current = null;
    }
    const hlEl = highlightedElementId
      ? elements.find((e) => e.id === highlightedElementId && e.visible)
      : null;
    if (hlEl) {
      const hlRect = new Konva.Rect({
        x: hlEl.x - 3 / zoom,
        y: hlEl.y - 3 / zoom,
        width: hlEl.width + 6 / zoom,
        height: hlEl.height + 6 / zoom,
        rotation: hlEl.rotation || 0,
        stroke: '#F59E0B',
        strokeWidth: 2 / zoom,
        dash: [4 / zoom, 2 / zoom],
        listening: false,
      });
      layer.add(hlRect);
      highlightRectRef.current = hlRect;
    }

    layer.batchDraw();
  }, [
    elements,
    selectedIds,
    zoom,
    cropMode,
    interactionMode,
    highlightedElementId,
    activeTool,
    stylePainterActive,
  ]);

  // Render content boundary indicator & interactive visual crop handles
  useEffect(() => {
    const cropLayer = cropLayerRef.current;
    const cropTr = cropTransformerRef.current;
    if (!cropLayer || !cropTr) return;

    cropLayer.getChildren().forEach((child) => {
      if (child !== cropTr) child.destroy();
    });
    cropTr.nodes([]);

    if (detectedContentBox && (cropMode || fitConfig.boundaryMode === 'auto_content')) {
      cropLayer.add(
        new Konva.Rect({
          x: detectedContentBox.x,
          y: detectedContentBox.y,
          width: detectedContentBox.width,
          height: detectedContentBox.height,
          stroke: '#525252',
          strokeWidth: 1 / zoom,
          dash: [5 / zoom, 3 / zoom],
          listening: false,
        })
      );
    }

    const showDimOverlay =
      cropMode || fitConfig.boundaryMode !== 'original_page';

    if (showDimOverlay) {
      const b = activeSourceBox;
      const maskFill = cropMode ? 'rgba(0, 0, 0, 0.46)' : 'rgba(0, 0, 0, 0.24)';
      if (b.y > 0) {
        cropLayer.add(
          new Konva.Rect({
            x: 0,
            y: 0,
            width: canvasW,
            height: b.y,
            fill: maskFill,
            listening: false,
          })
        );
      }
      if (b.y + b.height < canvasH) {
        cropLayer.add(
          new Konva.Rect({
            x: 0,
            y: b.y + b.height,
            width: canvasW,
            height: canvasH - (b.y + b.height),
            fill: maskFill,
            listening: false,
          })
        );
      }
      if (b.x > 0) {
        cropLayer.add(
          new Konva.Rect({
            x: 0,
            y: b.y,
            width: b.x,
            height: b.height,
            fill: maskFill,
            listening: false,
          })
        );
      }
      if (b.x + b.width < canvasW) {
        cropLayer.add(
          new Konva.Rect({
            x: b.x + b.width,
            y: b.y,
            width: canvasW - (b.x + b.width),
            height: b.height,
            fill: maskFill,
            listening: false,
          })
        );
      }
    }

    if (cropMode) {
      const b = activeSourceBox;
      const cropRectNode = new Konva.Rect({
        id: 'studio-crop-box',
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        stroke: '#101010',
        strokeWidth: 1.5 / zoom,
        fill: 'rgba(16, 16, 16, 0.04)',
        draggable: true,
        dragBoundFunc: (pos) => {
          const z = callbacksRef.current.zoom;
          const maxX = Math.max(0, (callbacksRef.current.canvasW - b.width) * z);
          const maxY = Math.max(0, (callbacksRef.current.canvasH - b.height) * z);
          return {
            x: Math.max(0, Math.min(pos.x, maxX)),
            y: Math.max(0, Math.min(pos.y, maxY)),
          };
        },
      });

      cropRectNode.on('dragend', () => {
        const next = clampRect(
          {
            x: cropRectNode.x(),
            y: cropRectNode.y(),
            width: cropRectNode.width(),
            height: cropRectNode.height(),
          },
          callbacksRef.current.canvasW,
          callbacksRef.current.canvasH
        );
        callbacksRef.current.onChangeCropRect(next);
      });

      cropRectNode.on('transformend', () => {
        const sx = cropRectNode.scaleX();
        const sy = cropRectNode.scaleY();
        const nextW = cropRectNode.width() * sx;
        const nextH = cropRectNode.height() * sy;
        cropRectNode.scaleX(1);
        cropRectNode.scaleY(1);
        const next = clampRect(
          {
            x: cropRectNode.x(),
            y: cropRectNode.y(),
            width: nextW,
            height: nextH,
          },
          callbacksRef.current.canvasW,
          callbacksRef.current.canvasH
        );
        callbacksRef.current.onChangeCropRect(next);
      });

      cropLayer.add(cropRectNode);
      cropTr.nodes([cropRectNode]);
      cropTr.moveToTop();
    } else if (fitConfig.boundaryMode !== 'original_page') {
      cropLayer.add(
        new Konva.Rect({
          x: activeSourceBox.x,
          y: activeSourceBox.y,
          width: activeSourceBox.width,
          height: activeSourceBox.height,
          stroke: '#404040',
          strokeWidth: 1.2 / zoom,
          listening: false,
        })
      );
    }

    cropLayer.batchDraw();
  }, [
    cropMode,
    fitConfig.boundaryMode,
    activeSourceBox,
    detectedContentBox,
    canvasW,
    canvasH,
    zoom,
  ]);

  // Native non-passive Pinch-to-Zoom, Two-Finger Pan & Active Gesture Scroll-Lock
  useEffect(() => {
    const wrapper = scrollWrapperRef.current;
    const stageBox = stageBoxRef.current;
    if (!wrapper) return;

    const handleNativeTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        clearLongPress();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        touchGestureRef.current = {
          active: true,
          initialDist: Math.max(10, dist),
          initialZoom: callbacksRef.current.zoom,
          lastMidX: midX,
          lastMidY: midY,
        };
      }
    };

    const handleNativeTouchMove = (e: TouchEvent) => {
      const g = touchGestureRef.current;
      if (g.active && e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;

        if (callbacksRef.current.onZoomChange && g.initialDist > 0) {
          const nextZoom = Math.max(
            0.25,
            Math.min(3, g.initialZoom * (dist / g.initialDist))
          );
          callbacksRef.current.onZoomChange(Number(nextZoom.toFixed(2)));
        }

        const dx = midX - g.lastMidX;
        const dy = midY - g.lastMidY;
        wrapper.scrollLeft -= dx;
        wrapper.scrollTop -= dy;
        g.lastMidX = midX;
        g.lastMidY = midY;
      } else if (
        e.touches.length === 1 &&
        (isManipulatingRef.current || marqueeRef.current.active)
      ) {
        e.preventDefault();
      }
    };

    const handleNativeTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        touchGestureRef.current.active = false;
      }
      if (e.touches.length === 0) {
        clearLongPress();
      }
    };

    const handleStageBoxTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const cfg = callbacksRef.current;
      if (cfg.interactionMode !== 'edit') return;
      const isNonSelectTool = cfg.activeTool !== 'select';
      if (cfg.cropMode || isNonSelectTool || isManipulatingRef.current) {
        e.preventDefault();
        return;
      }
      // If single-touch begins directly over an element or transformer handle, prevent page scroll
      // so touching & immediately dragging an unselected element works on the first swipe!
      const stage = stageRef.current;
      const container = containerRef.current;
      if (stage && container) {
        const rect = container.getBoundingClientRect();
        const pt = {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
        const hit = stage.getIntersection(pt);
        if (hit && (hit as unknown) !== stage) {
          e.preventDefault();
        }
      }
    };

    wrapper.addEventListener('touchstart', handleNativeTouchStart, { passive: false });
    wrapper.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    wrapper.addEventListener('touchend', handleNativeTouchEnd);
    wrapper.addEventListener('touchcancel', handleNativeTouchEnd);
    stageBox?.addEventListener('touchstart', handleStageBoxTouchStart, { passive: false });

    return () => {
      wrapper.removeEventListener('touchstart', handleNativeTouchStart);
      wrapper.removeEventListener('touchmove', handleNativeTouchMove);
      wrapper.removeEventListener('touchend', handleNativeTouchEnd);
      wrapper.removeEventListener('touchcancel', handleNativeTouchEnd);
      stageBox?.removeEventListener('touchstart', handleStageBoxTouchStart);
    };
  }, []);

  const inlineElement = elements.find((e) => e.id === inlineEditId) || null;
  const tableElement = elements.find((e) => e.id === tableEditId) || null;
  const contextElement = contextMenu
    ? elements.find((e) => e.id === contextMenu.elementId) || null
    : null;

  // Compute ruler ticks in template coordinate space
  const rulerStepPt = 72; // 1 inch / 72pt ticks
  const hTicks: number[] = [];
  for (let x = 0; x <= canvasW; x += rulerStepPt) hTicks.push(x);
  const vTicks: number[] = [];
  for (let y = 0; y <= canvasH; y += rulerStepPt) vTicks.push(y);

  // Prevent browser page scroll while using non-select creation/marquee tools, cropping, transforming, or dragging
  const blockStageTouchScroll =
    interactionMode === 'edit' &&
    (activeTool !== 'select' ||
      stylePainterActive ||
      selectedIds.length > 0 ||
      cropMode ||
      isManipulating);

  return (
    <div
      ref={scrollWrapperRef}
      className="flex-1 overflow-auto bg-[#EFEFEF] dark:bg-[#0B0B0B] flex items-start justify-center p-2.5 tablet:p-5 desktop:p-6 relative overscroll-contain"
    >
      <div className="relative inline-block shadow-xl">
        {/* Horizontal Ruler */}
        {effectiveRulers && (
          <div
            style={{ width: stageW, marginLeft: 24 }}
            className="h-6 bg-[#F7F7F7] dark:bg-[#111111] border border-black/15 dark:border-white/12 relative overflow-hidden select-none"
          >
            {hTicks.map((pt) => (
              <div
                key={pt}
                style={{ left: pt * zoom }}
                className="absolute top-0 bottom-0 border-l border-black/15 dark:border-white/15 text-[9px] font-mono text-[#555555] dark:text-[#858585] pl-1 pt-0.5 tabular-nums"
              >
                {ptToUnit(pt, pageConfig.unit)}
              </div>
            ))}
          </div>
        )}

        <div className="flex">
          {/* Vertical Ruler */}
          {effectiveRulers && (
            <div
              style={{ height: stageH }}
              className="w-6 bg-[#F7F7F7] dark:bg-[#111111] border-y border-l border-black/15 dark:border-white/12 relative overflow-hidden select-none shrink-0"
            >
              {vTicks.map((pt) => (
                <div
                  key={pt}
                  style={{ top: pt * zoom }}
                  className="absolute left-0 right-0 border-t border-black/15 dark:border-white/15 text-[9px] font-mono text-[#555555] dark:text-[#858585] pl-0.5 pt-0.5 tabular-nums"
                >
                  {Math.round(ptToUnit(pt, pageConfig.unit))}
                </div>
              ))}
            </div>
          )}

          {/* Konva Canvas Container */}
          <div
            ref={stageBoxRef}
            style={{
              touchAction: blockStageTouchScroll ? 'none' : 'pan-x pan-y',
              cursor:
                stylePainterActive || activeTool === 'style_painter'
                  ? 'copy'
                  : activeTool !== 'select' &&
                    activeTool !== 'marquee' &&
                    activeTool !== 'inspect'
                  ? 'crosshair'
                  : 'default',
            }}
            className="relative border border-black/20 dark:border-white/15 bg-white select-none"
          >
            <div ref={containerRef} />

            {liveMeasureHint && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 px-2.5 py-1 rounded-lg bg-[#101010] text-white text-[10px] font-mono shadow-lg pointer-events-none tabular-nums whitespace-nowrap">
                {liveMeasureHint}
              </div>
            )}

            {/* Inline double-click / double-tap text editor */}
            {inlineElement && (
              <textarea
                value={inlineText}
                autoFocus
                onChange={(e) => setInlineText(e.target.value)}
                onBlur={() => {
                  if (inlineText !== inlineElement.text) {
                    onUpdateElement(inlineElement.id, {
                      text: inlineText,
                      eraseOriginal: inlineElement.isUserAdded ? false : true,
                      needsReview: false,
                    });
                  }
                  setInlineEditId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setInlineEditId(null);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (inlineText !== inlineElement.text) {
                      onUpdateElement(inlineElement.id, {
                        text: inlineText,
                        eraseOriginal: inlineElement.isUserAdded ? false : true,
                        needsReview: false,
                      });
                    }
                    setInlineEditId(null);
                  }
                }}
                style={{
                  left: inlineElement.x * zoom,
                  top: inlineElement.y * zoom,
                  width: Math.max(120, inlineElement.width * zoom),
                  height: Math.max(36, inlineElement.height * zoom),
                  fontFamily: mapFontToCanvasCss(inlineElement.fontFamily),
                  fontSize: Math.max(12, inlineElement.fontSize * zoom),
                  fontWeight: inlineElement.fontWeight,
                  fontStyle: inlineElement.fontStyle,
                  textAlign: inlineElement.align,
                  color: inlineElement.color,
                  transform: inlineElement.rotation
                    ? `rotate(${inlineElement.rotation}deg)`
                    : undefined,
                  transformOrigin: 'top left',
                }}
                className="absolute z-20 p-1.5 bg-white/95 border-2 border-[#101010] rounded-xs outline-none resize-none leading-tight shadow-md"
              />
            )}
          </div>
        </div>
      </div>

      {/* Long-Press / Right-Click Context Menu */}
      <AnimatePresence>
        {contextMenu && contextElement && (
          <motion.div
            key="canvas-context-backdrop"
            variants={modalBackdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/25 tablet:bg-transparent"
            onClick={() => setContextMenu(null)}
          >
            <motion.div
              key="canvas-context-menu"
              variants={
                viewport.isMobile
                  ? {
                      initial: { opacity: 0, y: 24 },
                      animate: { opacity: 1, y: 0, transition: MOTION_SPRING.sheet },
                      exit: { opacity: 0, y: 20, pointerEvents: 'none', transition: { duration: MOTION_DURATION.fast } },
                    }
                  : popoverVariants
              }
              initial="initial"
              animate="animate"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              style={
                viewport.isMobile
                  ? undefined
                  : {
                      left: Math.min(viewport.width - 230, Math.max(12, contextMenu.x)),
                      top: Math.min(viewport.height - 320, Math.max(12, contextMenu.y)),
                    }
              }
              className={
                viewport.isMobile
                  ? 'fixed inset-x-3 bottom-4 z-50 rounded-2xl border glass-level-4 p-2 pb-safe'
                  : 'fixed z-50 w-56 rounded-2xl border glass-level-4 p-1.5'
              }
            >
              <div className="px-3 py-2 flex items-center justify-between border-b border-black/10 dark:border-white/12 mb-1">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#101010] dark:text-white truncate">
                    {contextElement.text || contextElement.type}
                  </div>
                  <div className="text-[10px] text-[#888888] dark:text-[#858585] capitalize">
                    {contextElement.type.replace('_', ' ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setContextMenu(null)}
                  className="p-2 text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-0.5 text-xs">
                {!contextElement.locked &&
                  contextElement.type !== 'image' &&
                  contextElement.type !== 'line' &&
                  contextElement.type !== 'shape' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (contextElement.type === 'table') {
                          setTableEditId(contextElement.id);
                        } else {
                          setInlineEditId(contextElement.id);
                          setInlineText(contextElement.text);
                        }
                        setContextMenu(null);
                      }}
                      className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-lg flex items-center gap-2.5 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      <Edit3 className="w-4 h-4 text-[#101010] dark:text-white" />
                      {contextElement.type === 'table' ? 'Edit Table Cells' : 'Edit Text'}
                    </button>
                  )}

                {onOpenProperties && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectIds([contextElement.id]);
                      onOpenProperties();
                      setContextMenu(null);
                    }}
                    className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-lg flex items-center gap-2.5 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    <Sliders className="w-4 h-4 text-[#555555] dark:text-[#B5B5B5]" />
                    Element Properties
                  </button>
                )}

                {onDuplicateElement && (
                  <button
                    type="button"
                    onClick={() => {
                      onDuplicateElement(contextElement.id);
                      setContextMenu(null);
                    }}
                    className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-lg flex items-center gap-2.5 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    <Copy className="w-4 h-4 text-[#555555] dark:text-[#B5B5B5]" />
                    Duplicate
                  </button>
                )}

                {onReorderElement && (
                  <div className="grid grid-cols-2 gap-1 px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        onReorderElement(contextElement.id, 'forward');
                        setContextMenu(null);
                      }}
                      className="min-h-[44px] tablet:min-h-[32px] px-2 rounded-lg flex items-center justify-center gap-1.5 border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                      Forward
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onReorderElement(contextElement.id, 'backward');
                        setContextMenu(null);
                      }}
                      className="min-h-[44px] tablet:min-h-[32px] px-2 rounded-lg flex items-center justify-center gap-1.5 border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                      Backward
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onUpdateElement(contextElement.id, {
                      locked: !contextElement.locked,
                    });
                    setContextMenu(null);
                  }}
                  className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-lg flex items-center gap-2.5 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                >
                  {contextElement.locked ? (
                    <>
                      <Unlock className="w-4 h-4 text-[#101010] dark:text-white" />
                      Unlock Layer
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-[#555555] dark:text-[#B5B5B5]" />
                      Lock Layer
                    </>
                  )}
                </button>

                {onDeleteElement && (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteElement(contextElement.id);
                      setContextMenu(null);
                    }}
                    className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-lg flex items-center gap-2.5 text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Element
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table Cell Editor Modal */}
      <AnimatePresence>
        {tableElement && tableElement.tableData && (() => {
          const td = tableElement.tableData;
          const rCount = td.rows.length;
          const cCount = td.rows[0]?.length || 1;
          const coveredSet = new Set<string>();
          const anchorSpanMap = new Map<string, { rowSpan: number; colSpan: number }>();
          for (const m of td.mergedCells || []) {
            anchorSpanMap.set(`${m.row}:${m.col}`, {
              rowSpan: m.rowSpan,
              colSpan: m.colSpan,
            });
            for (let rr = m.row; rr < Math.min(rCount, m.row + m.rowSpan); rr++) {
              for (let cc = m.col; cc < Math.min(cCount, m.col + m.colSpan); cc++) {
                if (rr !== m.row || cc !== m.col) coveredSet.add(`${rr}:${cc}`);
              }
            }
          }
          const selMinR = tableCellSel ? Math.min(tableCellSel.r1, tableCellSel.r2) : -1;
          const selMaxR = tableCellSel ? Math.max(tableCellSel.r1, tableCellSel.r2) : -1;
          const selMinC = tableCellSel ? Math.min(tableCellSel.c1, tableCellSel.c2) : -1;
          const selMaxC = tableCellSel ? Math.max(tableCellSel.c1, tableCellSel.c2) : -1;
          const canMerge =
            Boolean(tableCellSel) && (selMaxR > selMinR || selMaxC > selMinC);
          const focusedAnchorMerged =
            Boolean(tableCellSel) &&
            (td.mergedCells || []).some(
              (m) =>
                selMinR >= m.row &&
                selMinR < m.row + m.rowSpan &&
                selMinC >= m.col &&
                selMinC < m.col + m.colSpan
            );

          return (
            <motion.div
              key="table-editor-backdrop"
              variants={modalBackdropVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              onClick={() => {
                setTableEditId(null);
                setTableCellSel(null);
              }}
              className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70 backdrop-blur-sm flex items-end tablet:items-center justify-center p-2 tablet:p-4"
            >
              <motion.div
                key="table-editor-panel"
                variants={modalPanelVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl max-h-[88dvh] rounded-t-3xl tablet:rounded-2xl border glass-level-4 p-4 tablet:p-5 flex flex-col"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-black/10 dark:border-white/12 shrink-0">
                  <div>
                    <h3 className="text-sm font-semibold text-[#101010] dark:text-white">
                      Edit Table Structure &amp; Cells
                    </h3>
                    <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                      Click a cell to focus, Shift+Click another cell to select a range for Merge/Split.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-[#101010] dark:text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={td.headerRow !== false}
                        onChange={(e) =>
                          onUpdateElement(tableElement.id, {
                            eraseOriginal: tableElement.isUserAdded ? false : true,
                            tableData: { ...td, headerRow: e.target.checked },
                          })
                        }
                      />
                      Header Row
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-[#101010] dark:text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={td.hasBorders !== false}
                        onChange={(e) =>
                          onUpdateElement(tableElement.id, {
                            eraseOriginal: tableElement.isUserAdded ? false : true,
                            tableData: { ...td, hasBorders: e.target.checked },
                          })
                        }
                      />
                      Borders
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setTableEditId(null);
                        setTableCellSel(null);
                      }}
                      className="min-h-[36px] px-2.5 text-xs text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
                <div className="mt-3 overflow-auto flex-1">
                  <table className="w-full border-collapse text-xs">
                    <tbody>
                      {td.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {row.map((cell, cIdx) => {
                            const key = `${rIdx}:${cIdx}`;
                            if (coveredSet.has(key)) return null;
                            const span = anchorSpanMap.get(key) || {
                              rowSpan: 1,
                              colSpan: 1,
                            };
                            const inSel =
                              rIdx >= selMinR &&
                              rIdx <= selMaxR &&
                              cIdx >= selMinC &&
                              cIdx <= selMaxC;
                            return (
                              <td
                                key={cIdx}
                                rowSpan={span.rowSpan}
                                colSpan={span.colSpan}
                                onClick={(e) => {
                                  if (e.shiftKey && tableCellSel) {
                                    setTableCellSel({
                                      ...tableCellSel,
                                      r2: rIdx,
                                      c2: cIdx,
                                    });
                                  } else {
                                    setTableCellSel({
                                      r1: rIdx,
                                      c1: cIdx,
                                      r2: rIdx,
                                      c2: cIdx,
                                    });
                                  }
                                }}
                                className={`border p-0 min-w-[96px] align-top transition-colors ${
                                  inSel
                                    ? 'border-blue-500 bg-blue-500/10'
                                    : 'border-black/15 dark:border-white/15'
                                }`}
                              >
                                <textarea
                                  rows={Math.max(1, String(cell).split('\n').length)}
                                  value={cell}
                                  onChange={(e) => {
                                    const nextRows = td.rows.map((r, ri) =>
                                      ri === rIdx
                                        ? r.map((c, ci) =>
                                            ci === cIdx ? e.target.value : c
                                          )
                                        : r
                                    );
                                    onUpdateElement(tableElement.id, {
                                      eraseOriginal: tableElement.isUserAdded
                                        ? false
                                        : true,
                                      tableData: {
                                        ...td,
                                        rows: nextRows,
                                      },
                                    });
                                  }}
                                  className="w-full min-h-[38px] px-2.5 py-1.5 bg-transparent text-[#101010] dark:text-white resize-y focus:outline-none focus:bg-black/[0.04] dark:focus:bg-white/[0.06]"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 shrink-0 pb-safe">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextColW = td.colWidthsPt
                          ? [...td.colWidthsPt]
                          : undefined;
                        const avgH = Number((tableElement.height / Math.max(1, rCount)).toFixed(2));
                        const nextRowH = td.rowHeightsPt
                          ? [...td.rowHeightsPt, avgH]
                          : undefined;
                        onUpdateElement(tableElement.id, {
                          eraseOriginal: tableElement.isUserAdded ? false : true,
                          tableData: {
                            ...td,
                            rows: [...td.rows, Array(cCount).fill('')],
                            colWidthsPt: nextColW,
                            rowHeightsPt: nextRowH,
                          },
                        });
                      }}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      + Row
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const avgW = Number((tableElement.width / Math.max(1, cCount)).toFixed(2));
                        const nextColW = td.colWidthsPt
                          ? [...td.colWidthsPt, avgW]
                          : undefined;
                        onUpdateElement(tableElement.id, {
                          eraseOriginal: tableElement.isUserAdded ? false : true,
                          tableData: {
                            ...td,
                            rows: td.rows.map((r) => [...r, '']),
                            colWidthsPt: nextColW,
                          },
                        });
                      }}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      + Column
                    </button>
                    <button
                      type="button"
                      disabled={!canMerge}
                      onClick={() => {
                        if (!tableCellSel) return;
                        const merged = mergeTableCellRange(
                          td,
                          tableCellSel.r1,
                          tableCellSel.c1,
                          tableCellSel.r2,
                          tableCellSel.c2
                        );
                        onUpdateElement(tableElement.id, {
                          eraseOriginal: tableElement.isUserAdded ? false : true,
                          tableData: merged,
                        });
                        setTableCellSel({
                          r1: selMinR,
                          c1: selMinC,
                          r2: selMinR,
                          c2: selMinC,
                        });
                      }}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-40 transition-colors"
                    >
                      Merge Cells
                    </button>
                    <button
                      type="button"
                      disabled={!focusedAnchorMerged}
                      onClick={() => {
                        if (!tableCellSel) return;
                        const split = splitMergedTableCell(td, selMinR, selMinC);
                        onUpdateElement(tableElement.id, {
                          eraseOriginal: tableElement.isUserAdded ? false : true,
                          tableData: split,
                        });
                      }}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-40 transition-colors"
                    >
                      Split Cell
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTableEditId(null);
                      setTableCellSel(null);
                    }}
                    className="min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] transition-colors active:scale-[0.98]"
                  >
                    Apply Table
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

