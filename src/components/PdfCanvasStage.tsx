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
import { clampRect } from '../utils/geometryEngine';
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
    if (!backgroundImageUrl) {
      setBgImgObj(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBgImgObj(img);
    img.src = backgroundImageUrl;
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

    stage.on('mousedown touchstart', (e) => {
      const tool = callbacksRef.current.activeTool;
      const isCreationTool =
        tool !== 'select' &&
        tool !== 'marquee' &&
        tool !== 'inspect' &&
        tool !== 'style_painter' &&
        !callbacksRef.current.stylePainterActive;

      if (e.target === stage || isCreationTool) {
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

          const isMouse = evt && 'button' in evt && !('touches' in evt && (evt as unknown as TouchEvent).touches?.length);
          if (isMouse && evt.button === 0 && e.target === stage) {
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
              shiftHeld: Boolean(evt.shiftKey),
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

    stage.on('mouseup touchend', () => {
      const m = marqueeRef.current;
      if (!m.active) return;

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

  // Render elements layer
  useEffect(() => {
    const layer = elementsLayerRef.current;
    const tr = transformerRef.current;
    const guideLayer = guideLayerRef.current;
    if (!layer || !tr || !guideLayer) return;

    const isPreview = interactionMode === 'preview';
    layer.listening(!isPreview);

    // Remove all children except transformer
    layer.getChildren().forEach((child) => {
      if (child !== tr) {
        child.destroy();
      }
    });
    nodeMapRef.current.clear();

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
        draggable: !isPreview && !el.locked,
        opacity: el.opacity ?? 1,
      });

      const isSelected = !isPreview && selectedIds.includes(el.id);
      const showBoxOutline =
        !isPreview &&
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
            stroke: isPreview
              ? 'transparent'
              : el.redactionApplied
              ? '#525252'
              : '#FFFFFF',
            strokeWidth: 1 / zoom,
            dash: !isPreview && !el.redactionApplied ? [4 / zoom, 2 / zoom] : undefined,
          })
        );
        if (!isPreview) {
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
          : isPreview
          ? 'transparent'
          : 'rgba(16, 16, 16, 0.25)';
        const strokeW = isModifiedOrAdded ? el.borderWidth ?? 1.2 : 0.75 / zoom;

        if (el.shapeKind === 'circle') {
          group.add(
            new Konva.Ellipse({
              x: el.width / 2,
              y: el.height / 2,
              radiusX: el.width / 2,
              radiusY: el.height / 2,
              fill:
                isModifiedOrAdded && el.backgroundColor !== 'transparent'
                  ? el.backgroundColor
                  : undefined,
              stroke: strokeColor,
              strokeWidth: strokeW,
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
              hitStrokeWidth: isTouchLargeHandles ? 18 : 8,
            })
          );
        } else {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              fill:
                isModifiedOrAdded && el.backgroundColor !== 'transparent'
                  ? el.backgroundColor
                  : undefined,
              stroke: strokeColor,
              strokeWidth: strokeW,
              hitStrokeWidth: isTouchLargeHandles ? 16 : 6,
            })
          );
        }
      } else if (el.type === 'line') {
        group.add(
          new Konva.Rect({
            width: el.width,
            height: Math.max(isTouchLargeHandles ? 20 : 8, el.height),
            fill: 'rgba(0,0,0,0.001)',
          })
        );
        group.add(
          new Konva.Line({
            points: [
              0,
              Math.max(isTouchLargeHandles ? 20 : 8, el.height) / 2,
              el.width,
              Math.max(isTouchLargeHandles ? 20 : 8, el.height) / 2,
            ],
            stroke: isModifiedOrAdded
              ? el.color || '#1E293B'
              : isSelected
              ? '#101010'
              : isPreview
              ? 'transparent'
              : 'rgba(16, 16, 16, 0.28)',
            strokeWidth: isModifiedOrAdded ? el.borderWidth ?? 1.5 : 0.8 / zoom,
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
              strokeWidth: 0.8 / zoom,
              dash: [4, 2],
            })
          );
        }
      } else if (el.type === 'table' && el.tableData) {
        const { rows, borderColor, headerBgColor, headerRow, cellPadding } =
          el.tableData;
        const rCount = Math.max(1, rows.length);
        const cCount = Math.max(1, rows[0]?.length || 1);
        const rH = el.height / rCount;
        const cW = el.width / cCount;

        for (let r = 0; r < rCount; r++) {
          for (let c = 0; c < cCount; c++) {
            group.add(
              new Konva.Rect({
                x: c * cW,
                y: r * rH,
                width: cW,
                height: rH,
                fill:
                  headerRow && r === 0
                    ? headerBgColor || '#F1F5F9'
                    : '#FFFFFF',
                stroke: borderColor || '#CBD5E1',
                strokeWidth: 0.8,
              })
            );
            group.add(
              new Konva.Text({
                x: c * cW + (cellPadding || 4),
                y: r * rH + (cellPadding || 4),
                width: Math.max(8, cW - (cellPadding || 4) * 2),
                height: Math.max(8, rH - (cellPadding || 4) * 2),
                text: String(rows[r]?.[c] ?? ''),
                fontSize: Math.min(el.fontSize || 9.5, rH * 0.6),
                fontStyle: headerRow && r === 0 ? 'bold' : 'normal',
                fill: el.color || '#111827',
                verticalAlign: 'middle',
              })
            );
          }
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
                : isPreview
                ? 'transparent'
                : 'rgba(16, 16, 16, 0.015)',
            stroke: isPreview
              ? 'transparent'
              : el.needsReview
              ? '#D97706'
              : showBoxOutline
              ? 'rgba(16, 16, 16, 0.45)'
              : 'rgba(115, 115, 115, 0.25)',
            strokeWidth: (el.needsReview ? 1.2 : 0.7) / zoom,
            dash: !isPreview && el.needsReview ? [3 / zoom, 2 / zoom] : undefined,
          })
        );

        if (shouldDrawFillAndText && typo) {
          const textDeco = [
            el.underline ? 'underline' : '',
            el.strikethrough ? 'line-through' : '',
          ]
            .filter(Boolean)
            .join(' ');
          group.add(
            new Konva.Text({
              y: -(el.baselineOffset || 0),
              width: el.width,
              height: el.height,
              text: el.text,
              fontFamily: mapFontToCanvasCss(el.fontFamily),
              fontSize: typo.effectiveFontSize,
              fontStyle:
                `${el.fontWeight === 'bold' ? 'bold' : ''} ${
                  el.fontStyle === 'italic' ? 'italic' : ''
                }`.trim() || 'normal',
              textDecoration: textDeco || undefined,
              letterSpacing: el.letterSpacing ?? 0,
              lineHeight: el.lineHeight ?? 1.2,
              fill: el.color || '#111827',
              align: el.align || 'left',
              verticalAlign: el.verticalAlign || 'top',
              wrap: el.textWrap === false ? 'none' : 'word',
              padding: Math.max(0, el.paddingPt ?? 1),
            })
          );
          if (!isPreview && typo.isClipped) {
            group.add(
              new Konva.Circle({
                x: el.width - 3 / zoom,
                y: el.height - 3 / zoom,
                radius: 2.5 / zoom,
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
          longPressStartPosRef.current = { x: t.clientX, y: t.clientY };
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
          if (curr.includes(el.id)) {
            callbacksRef.current.onSelectIds(curr.filter((i) => i !== el.id));
          } else {
            callbacksRef.current.onSelectIds([...curr, el.id]);
          }
        } else {
          if (el.groupId) {
            const grouped = callbacksRef.current.elements
              .filter((x) => x.groupId === el.groupId)
              .map((x) => x.id);
            callbacksRef.current.onSelectIds(grouped);
          } else {
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
        setIsManipulating(true);
      });

      group.on('dragmove', () => {
        const guided = drawGuides(el, group.x(), group.y());
        group.x(guided.x);
        group.y(guided.y);
      });

      group.on('dragend', () => {
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

      group.on('transformstart', () => {
        clearLongPress();
        setIsManipulating(true);
      });

      group.on('transformend', () => {
        setIsManipulating(false);
        const scaleX = group.scaleX();
        const scaleY = group.scaleY();
        group.scaleX(1);
        group.scaleY(1);
        callbacksRef.current.onUpdateElement(el.id, {
          x: Number(group.x().toFixed(2)),
          y: Number(group.y().toFixed(2)),
          width: Number(Math.max(8, el.width * scaleX).toFixed(2)),
          height: Number(Math.max(8, el.height * scaleY).toFixed(2)),
          rotation: Math.round(group.rotation()),
          eraseOriginal: el.isUserAdded ? false : true,
        });
      });

      if (highlightedElementId === el.id) {
        group.add(
          new Konva.Rect({
            x: -3 / zoom,
            y: -3 / zoom,
            width: el.width + 6 / zoom,
            height: el.height + 6 / zoom,
            stroke: '#F59E0B',
            strokeWidth: 2 / zoom,
            dash: [4 / zoom, 2 / zoom],
            listening: false,
          })
        );
      }

      layer.add(group);
      nodeMapRef.current.set(el.id, group);
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
    layer.batchDraw();
  }, [
    elements,
    selectedIds,
    elementImgs,
    pageConfig,
    zoom,
    cropMode,
    interactionMode,
    isTouchLargeHandles,
    highlightedElementId,
    measureUnit,
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

  // Pinch-to-Zoom and Two-Finger Panning Handlers on Scroll Container
  const handleContainerTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      clearLongPress();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      touchGestureRef.current = {
        active: true,
        initialDist: Math.max(10, dist),
        initialZoom: zoom,
        lastMidX: midX,
        lastMidY: midY,
      };
    }
  };

  const handleContainerTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const g = touchGestureRef.current;
    if (g.active && e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      if (onZoomChange && g.initialDist > 0) {
        const nextZoom = Math.max(
          0.25,
          Math.min(3, g.initialZoom * (dist / g.initialDist))
        );
        onZoomChange(Number(nextZoom.toFixed(2)));
      }

      const wrapper = scrollWrapperRef.current;
      if (wrapper) {
        const dx = midX - g.lastMidX;
        const dy = midY - g.lastMidY;
        wrapper.scrollLeft -= dx;
        wrapper.scrollTop -= dy;
      }
      g.lastMidX = midX;
      g.lastMidY = midY;
    }
  };

  const handleContainerTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) {
      touchGestureRef.current.active = false;
    }
  };

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

  // Prevent browser page scroll while dragging/resizing selected element or cropping in Edit mode
  const blockStageTouchScroll =
    interactionMode === 'edit' &&
    (selectedIds.length > 0 || cropMode || isManipulating);

  return (
    <div
      ref={scrollWrapperRef}
      onTouchStart={handleContainerTouchStart}
      onTouchMove={handleContainerTouchMove}
      onTouchEnd={handleContainerTouchEnd}
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
                  onUpdateElement(inlineElement.id, {
                    text: inlineText,
                    eraseOriginal: inlineElement.isUserAdded ? false : true,
                    needsReview: false,
                  });
                  setInlineEditId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setInlineEditId(null);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onUpdateElement(inlineElement.id, {
                      text: inlineText,
                      eraseOriginal: inlineElement.isUserAdded ? false : true,
                      needsReview: false,
                    });
                    setInlineEditId(null);
                  }
                }}
                style={{
                  left: inlineElement.x * zoom,
                  top: inlineElement.y * zoom,
                  width: Math.max(120, inlineElement.width * zoom),
                  height: Math.max(36, inlineElement.height * zoom),
                  fontSize: Math.max(12, inlineElement.fontSize * zoom),
                  fontWeight: inlineElement.fontWeight,
                  color: inlineElement.color,
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
        {tableElement && tableElement.tableData && (
          <motion.div
            key="table-editor-backdrop"
            variants={modalBackdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => setTableEditId(null)}
            className="fixed inset-0 z-50 bg-black/40 dark:bg-black/70 backdrop-blur-sm flex items-end tablet:items-center justify-center p-2 tablet:p-4"
          >
            <motion.div
              key="table-editor-panel"
              variants={modalPanelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl max-h-[85dvh] rounded-t-3xl tablet:rounded-2xl border glass-level-4 p-4 tablet:p-5 flex flex-col"
            >
              <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/12 shrink-0">
                <h3 className="text-sm font-semibold text-[#101010] dark:text-white">
                  Edit Table Cells
                </h3>
                <button
                  type="button"
                  onClick={() => setTableEditId(null)}
                  className="min-h-[44px] px-3 text-xs text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white transition-colors"
                >
                  Done
                </button>
              </div>
              <div className="mt-3 overflow-auto flex-1">
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {tableElement.tableData.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="border border-black/15 dark:border-white/15 p-0 min-w-[90px]"
                          >
                            <input
                              type="text"
                              value={cell}
                              onChange={(e) => {
                                const nextRows = tableElement.tableData!.rows.map(
                                  (r, ri) =>
                                    ri === rIdx
                                      ? r.map((c, ci) =>
                                          ci === cIdx ? e.target.value : c
                                        )
                                      : r
                                );
                                onUpdateElement(tableElement.id, {
                                  tableData: {
                                    ...tableElement.tableData!,
                                    rows: nextRows,
                                  },
                                });
                              }}
                              className="w-full min-h-[40px] px-2.5 py-2 bg-transparent text-[#101010] dark:text-white focus:outline-none focus:bg-black/[0.04] dark:focus:bg-white/[0.06]"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 shrink-0 pb-safe">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const colCount = tableElement.tableData!.rows[0]?.length || 2;
                      onUpdateElement(tableElement.id, {
                        tableData: {
                          ...tableElement.tableData!,
                          rows: [
                            ...tableElement.tableData!.rows,
                            Array(colCount).fill(''),
                          ],
                        },
                      });
                    }}
                    className="min-h-[44px] px-3 py-2 rounded-lg text-xs border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    + Row
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateElement(tableElement.id, {
                        tableData: {
                          ...tableElement.tableData!,
                          rows: tableElement.tableData!.rows.map((r) => [...r, '']),
                        },
                      });
                    }}
                    className="min-h-[44px] px-3 py-2 rounded-lg text-xs border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                  >
                    + Column
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setTableEditId(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg text-xs font-semibold bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] transition-colors active:scale-[0.98]"
                >
                  Apply Table
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

