import React, { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
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
  DocumentElement,
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
import { ptToUnit } from '../utils/units';

interface PdfCanvasStageProps {
  pageConfig: PageConfig;
  backgroundImageUrl?: string;
  originalPageSize?: { widthPt: number; heightPt: number };
  elements: DocumentElement[];
  selectedIds: string[];
  zoom: number;
  interactionMode?: 'preview' | 'edit';
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
  const [elementImgs, setElementImgs] = useState<Record<string, HTMLImageElement>>({});
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineText, setInlineText] = useState('');
  const [tableEditId, setTableEditId] = useState<string | null>(null);
  const [isManipulating, setIsManipulating] = useState(false);
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
    viewportWidth: viewport.width,
  });
  callbacksRef.current = {
    onSelectIds,
    onUpdateElement,
    onUpdateElementsBatch,
    onChangeCropRect,
    onZoomChange,
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
    viewportWidth: viewport.width,
  };

  const marqueeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    rectNode: Konva.Rect | null;
    shiftHeld: boolean;
  }>({ active: false, startX: 0, startY: 0, rectNode: null, shiftHeld: false });

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

  // Load any added element images
  useEffect(() => {
    elements.forEach((el) => {
      if (el.type === 'image' && el.imageDataUrl && !elementImgs[el.id]) {
        const img = new Image();
        img.onload = () => {
          setElementImgs((prev) => ({ ...prev, [el.id]: img }));
        };
        img.src = el.imageDataUrl;
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
      borderStroke: '#3B82F6',
      borderStrokeWidth: isTouchLargeHandles ? 2 : 1.5,
      anchorStroke: '#3B82F6',
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
      borderStroke: '#10B981',
      borderStrokeWidth: isTouchLargeHandles ? 2.2 : 1.8,
      anchorStroke: '#10B981',
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
      if (e.target === stage) {
        setInlineEditId(null);
        setContextMenu(null);
        const evt = e.evt as MouseEvent;
        const isMouse = evt && 'button' in evt && !('touches' in evt && (evt as unknown as TouchEvent).touches?.length);
        const pos = stage.getPointerPosition();
        if (
          isMouse &&
          evt.button === 0 &&
          pos &&
          callbacksRef.current.interactionMode === 'edit' &&
          !callbacksRef.current.cropMode
        ) {
          const z = callbacksRef.current.zoom;
          const sx = pos.x / z;
          const sy = pos.y / z;
          const marqueeRect = new Konva.Rect({
            x: sx,
            y: sy,
            width: 0,
            height: 0,
            fill: 'rgba(37, 99, 235, 0.12)',
            stroke: '#2563EB',
            strokeWidth: 1 / z,
            dash: [4 / z, 2 / z],
            listening: false,
          });
          guideLayer.add(marqueeRect);
          marqueeRef.current = {
            active: true,
            startX: sx,
            startY: sy,
            rectNode: marqueeRect,
            shiftHeld: Boolean(evt.shiftKey),
          };
        } else {
          callbacksRef.current.onSelectIds([]);
        }
      }
    });

    stage.on('mousemove', () => {
      const m = marqueeRef.current;
      if (!m.active || !m.rectNode) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const z = callbacksRef.current.zoom;
      const cx = pos.x / z;
      const cy = pos.y / z;
      m.rectNode.setAttrs({
        x: Math.min(m.startX, cx),
        y: Math.min(m.startY, cy),
        width: Math.abs(cx - m.startX),
        height: Math.abs(cy - m.startY),
      });
      guideLayer.batchDraw();
    });

    stage.on('mouseup', () => {
      const m = marqueeRef.current;
      if (!m.active) return;
      const rect = m.rectNode
        ? {
            x: m.rectNode.x(),
            y: m.rectNode.y(),
            width: m.rectNode.width(),
            height: m.rectNode.height(),
          }
        : null;
      m.rectNode?.destroy();
      marqueeRef.current = {
        active: false,
        startX: 0,
        startY: 0,
        rectNode: null,
        shiftHeld: false,
      };
      guideLayer.batchDraw();

      if (rect && (rect.width > 4 || rect.height > 4)) {
        const hitIds = getElementsInMarquee(callbacksRef.current.elements, rect);
        if (m.shiftHeld) {
          const merged = Array.from(
            new Set([...callbacksRef.current.selectedIds, ...hitIds])
          );
          callbacksRef.current.onSelectIds(merged);
        } else {
          callbacksRef.current.onSelectIds(hitIds);
        }
      } else if (!m.shiftHeld) {
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
        stroke: 'rgba(59, 130, 246, 0.28)',
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
            stroke: 'rgba(148, 163, 184, 0.22)',
            strokeWidth: 0.6 / zoom,
          })
        );
      }
      for (let y = gridSizePt; y < canvasH; y += gridSizePt) {
        gridLayer.add(
          new Konva.Line({
            points: [0, y, canvasW, y],
            stroke: 'rgba(148, 163, 184, 0.22)',
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
              stroke: g.kind === 'spacing' ? '#10B981' : '#2563EB',
              strokeWidth: 0.9 / callbacksRef.current.zoom,
              dash: [3 / callbacksRef.current.zoom, 3 / callbacksRef.current.zoom],
            })
          );
        } else {
          guideLayer.add(
            new Konva.Line({
              points: [g.start, g.pos, g.end, g.pos],
              stroke: g.kind === 'spacing' ? '#10B981' : '#2563EB',
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
                fill: '#10B981',
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

      if (el.type === 'shape' || el.type === 'border') {
        const strokeColor = isModifiedOrAdded
          ? el.borderColor || el.color || '#1E293B'
          : isSelected
          ? '#3B82F6'
          : isPreview
          ? 'transparent'
          : 'rgba(59, 130, 246, 0.22)';
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
              ? '#3B82F6'
              : isPreview
              ? 'transparent'
              : 'rgba(59, 130, 246, 0.25)',
            strokeWidth: isModifiedOrAdded ? el.borderWidth ?? 1.5 : 0.8 / zoom,
            hitStrokeWidth: isTouchLargeHandles ? 18 : 6,
          })
        );
      } else if (el.type === 'image') {
        const imgObj = elementImgs[el.id];
        if (imgObj) {
          group.add(
            new Konva.Image({
              width: el.width,
              height: el.height,
              image: imgObj,
            })
          );
        } else {
          group.add(
            new Konva.Rect({
              width: el.width,
              height: el.height,
              fill: 'rgba(59, 130, 246, 0.06)',
              stroke: 'rgba(59, 130, 246, 0.45)',
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
        group.add(
          new Konva.Rect({
            width: el.width,
            height: el.height,
            fill:
              el.backgroundColor && el.backgroundColor !== 'transparent'
                ? el.backgroundColor
                : isPreview
                ? 'transparent'
                : 'rgba(59, 130, 246, 0.02)',
            stroke: isPreview
              ? 'transparent'
              : el.needsReview
              ? '#D97706'
              : showBoxOutline
              ? 'rgba(59, 130, 246, 0.45)'
              : 'rgba(148, 163, 184, 0.25)',
            strokeWidth: (el.needsReview ? 1.2 : 0.7) / zoom,
            dash: !isPreview && el.needsReview ? [3 / zoom, 2 / zoom] : undefined,
          })
        );

        if (shouldDrawFillAndText) {
          group.add(
            new Konva.Text({
              width: el.width,
              height: el.height,
              text: el.text,
              fontFamily: mapFontToCanvasCss(el.fontFamily),
              fontSize: el.fontSize || 11,
              fontStyle: `${el.fontWeight === 'bold' ? 'bold' : ''} ${
                el.fontStyle === 'italic' ? 'italic' : ''
              }`.trim() || 'normal',
              fill: el.color || '#111827',
              align: el.align || 'left',
              padding: 1,
            })
          );
        }
      }

      // Click / single-finger tap selection + long-press trigger
      group.on('mousedown touchstart', (e) => {
        if (callbacksRef.current.interactionMode === 'preview') return;
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
          stroke: '#10B981',
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
      const maskFill = cropMode ? 'rgba(15, 23, 42, 0.45)' : 'rgba(15, 23, 42, 0.24)';
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
        stroke: '#10B981',
        strokeWidth: 1.5 / zoom,
        fill: 'rgba(16, 185, 129, 0.04)',
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
          stroke: '#10B981',
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
      className="flex-1 overflow-auto bg-slate-200/75 dark:bg-[#080B11] flex items-start justify-center p-2.5 tablet:p-5 desktop:p-6 relative overscroll-contain"
    >
      <div className="relative inline-block shadow-xl">
        {/* Horizontal Ruler */}
        {effectiveRulers && (
          <div
            style={{ width: stageW, marginLeft: 24 }}
            className="h-6 bg-slate-100 dark:bg-[#131A26] border border-slate-300 dark:border-slate-800 relative overflow-hidden select-none"
          >
            {hTicks.map((pt) => (
              <div
                key={pt}
                style={{ left: pt * zoom }}
                className="absolute top-0 bottom-0 border-l border-slate-300 dark:border-slate-700 text-[9px] font-mono text-slate-500 dark:text-slate-400 pl-1 pt-0.5 tabular-nums"
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
              className="w-6 bg-slate-100 dark:bg-[#131A26] border-y border-l border-slate-300 dark:border-slate-800 relative overflow-hidden select-none shrink-0"
            >
              {vTicks.map((pt) => (
                <div
                  key={pt}
                  style={{ top: pt * zoom }}
                  className="absolute left-0 right-0 border-t border-slate-300 dark:border-slate-700 text-[9px] font-mono text-slate-500 dark:text-slate-400 pl-0.5 pt-0.5 tabular-nums"
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
            }}
            className="relative border border-slate-300 dark:border-slate-700 bg-white select-none"
          >
            <div ref={containerRef} />

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
                className="absolute z-20 p-1.5 bg-white/95 border-2 border-blue-500 rounded-xs outline-none resize-none leading-tight shadow-md"
              />
            )}
          </div>
        </div>
      </div>

      {/* Long-Press / Right-Click Context Menu */}
      {contextMenu && contextElement && (
        <div
          className="fixed inset-0 z-50 bg-black/25 tablet:bg-transparent"
          onClick={() => setContextMenu(null)}
        >
          <div
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
            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 mb-1">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {contextElement.text || contextElement.type}
                </div>
                <div className="text-[10px] text-slate-500 capitalize">
                  {contextElement.type.replace('_', ' ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setContextMenu(null)}
                className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
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
                    className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-md flex items-center gap-2.5 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="w-4 h-4 text-blue-500" />
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
                  className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-md flex items-center gap-2.5 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Sliders className="w-4 h-4 text-slate-500" />
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
                  className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-md flex items-center gap-2.5 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Copy className="w-4 h-4 text-slate-500" />
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
                    className="min-h-[44px] tablet:min-h-[32px] px-2 rounded-md flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                    className="min-h-[44px] tablet:min-h-[32px] px-2 rounded-md flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-md flex items-center gap-2.5 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {contextElement.locked ? (
                  <>
                    <Unlock className="w-4 h-4 text-amber-500" />
                    Unlock Layer
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-slate-500" />
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
                  className="w-full min-h-[44px] tablet:min-h-[34px] px-3 rounded-md flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Element
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Table Cell Editor Modal */}
      {tableElement && tableElement.tableData && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 dark:bg-black/65 backdrop-blur-sm flex items-end tablet:items-center justify-center p-2 tablet:p-4">
          <div className="w-full max-w-xl max-h-[85dvh] rounded-t-3xl tablet:rounded-2xl border glass-level-4 p-4 tablet:p-5 flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-white/10 shrink-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Edit Table Cells
              </h3>
              <button
                type="button"
                onClick={() => setTableEditId(null)}
                className="min-h-[44px] px-3 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
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
                          className="border border-slate-300 dark:border-slate-700 p-0 min-w-[90px]"
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
                            className="w-full min-h-[40px] px-2.5 py-2 bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none focus:bg-blue-500/10"
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
                  className="min-h-[44px] px-3 py-2 rounded text-xs border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  className="min-h-[44px] px-3 py-2 rounded text-xs border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  + Column
                </button>
              </div>
              <button
                type="button"
                onClick={() => setTableEditId(null)}
                className="min-h-[44px] px-4 py-2 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                Apply Table
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

