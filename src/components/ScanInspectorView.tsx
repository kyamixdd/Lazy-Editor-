import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FolderTree,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  Sliders,
  Table2,
  Type as TypeIcon,
  Unlink,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ConfidenceLevel,
  DocumentElement,
  DocumentHierarchyNode,
  ElementType,
  ObjectCategory,
  ObjectClassification,
  PDFProject,
  ScanCorrectionRule,
  StudioSettings,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import {
  buildCorrectionRuleFromElement,
  computeScanQualityReport,
  reconstructPageRelationshipsAndHierarchy,
} from '../utils/documentRelationshipEngine';
import { scoreToConfidenceLevel } from '../utils/geometryClassifier';
import { scanPdfLocally } from '../utils/localPdfScanner';
import { appendOperationLog } from '../utils/projectStorage';
import { convertSelectionToTableElement } from '../utils/tableReconstructionEngine';
import { triggerBlobDownload } from '../utils/downloadHelper';
import { GlassButton, GlassCard } from './glass';

export type ScanInspectorMode =
  | 'original'
  | 'objects'
  | 'classification'
  | 'tree'
  | 'confidence'
  | 'side_by_side';

interface ScanInspectorViewProps {
  project: PDFProject;
  settings: StudioSettings;
  onUpdateProject: (updated: PDFProject) => void;
  onInspectInEditor: (pageNumber: number, elementId?: string) => void;
}

const SUBTYPE_TO_TYPE_MAP: Record<
  ObjectClassification,
  { type: ElementType; category: ObjectCategory }
> = {
  text: { type: 'text', category: 'text' },
  text_run: { type: 'text', category: 'text' },
  text_group: { type: 'text', category: 'text' },
  paragraph: { type: 'text', category: 'text' },
  heading: { type: 'heading', category: 'text' },
  label: { type: 'text', category: 'text' },
  numeric_field: { type: 'text', category: 'text' },
  date_field: { type: 'text', category: 'text' },
  identifier_field: { type: 'invoice_number', category: 'text' },
  horizontal_line: { type: 'line', category: 'vector' },
  vertical_line: { type: 'line', category: 'vector' },
  diagonal_line: { type: 'line', category: 'vector' },
  dashed_line: { type: 'line', category: 'vector' },
  rect: { type: 'shape', category: 'vector' },
  rounded_rect: { type: 'shape', category: 'vector' },
  circle: { type: 'shape', category: 'vector' },
  ellipse: { type: 'shape', category: 'vector' },
  polygon: { type: 'shape', category: 'vector' },
  freeform_path: { type: 'shape', category: 'vector' },
  filled_shape: { type: 'shape', category: 'vector' },
  border: { type: 'border', category: 'vector' },
  divider: { type: 'line', category: 'vector' },
  logo: { type: 'image', category: 'image' },
  photograph: { type: 'image', category: 'image' },
  signature_image: { type: 'signature', category: 'image' },
  stamp_image: { type: 'image', category: 'image' },
  decorative_image: { type: 'image', category: 'image' },
  background_image: { type: 'image', category: 'image' },
  image_mask: { type: 'image', category: 'image' },
  table: { type: 'table', category: 'structural' },
  table_row: { type: 'table', category: 'structural' },
  table_column: { type: 'table', category: 'structural' },
  table_cell: { type: 'text', category: 'structural' },
  merged_cell: { type: 'text', category: 'structural' },
  document_block: { type: 'repeated_block', category: 'structural' },
  receipt_block: { type: 'repeated_block', category: 'structural' },
  invoice_block: { type: 'repeated_block', category: 'structural' },
  header: { type: 'text', category: 'structural' },
  footer: { type: 'text', category: 'structural' },
  section: { type: 'border', category: 'structural' },
  text_input: { type: 'form_field', category: 'form' },
  checkbox: { type: 'form_field', category: 'form' },
  radio_button: { type: 'form_field', category: 'form' },
  dropdown: { type: 'form_field', category: 'form' },
  signature_field: { type: 'form_field', category: 'form' },
  form_boundary: { type: 'form_field', category: 'form' },
};

const RECLASSIFY_OPTIONS: Array<{ value: ObjectClassification; label: string }> = [
  { value: 'heading', label: 'Text · Heading' },
  { value: 'label', label: 'Text · Label' },
  { value: 'paragraph', label: 'Text · Paragraph' },
  { value: 'text', label: 'Text · Body Run' },
  { value: 'identifier_field', label: 'Text · Invoice / Serial ID' },
  { value: 'date_field', label: 'Text · Date Field' },
  { value: 'numeric_field', label: 'Text · Numeric / Amount' },
  { value: 'horizontal_line', label: 'Vector · Horizontal Line' },
  { value: 'vertical_line', label: 'Vector · Vertical Line' },
  { value: 'dashed_line', label: 'Vector · Dashed Line' },
  { value: 'divider', label: 'Vector · Section Divider' },
  { value: 'rect', label: 'Vector · Rectangle' },
  { value: 'rounded_rect', label: 'Vector · Rounded Rectangle' },
  { value: 'border', label: 'Vector · Container Border' },
  { value: 'circle', label: 'Vector · Circle' },
  { value: 'ellipse', label: 'Vector · Ellipse' },
  { value: 'polygon', label: 'Vector · Polygon' },
  { value: 'freeform_path', label: 'Vector · Freeform Path' },
  { value: 'logo', label: 'Image · Logo' },
  { value: 'signature_image', label: 'Image · Signature' },
  { value: 'stamp_image', label: 'Image · Stamp' },
  { value: 'photograph', label: 'Image · Photograph' },
  { value: 'background_image', label: 'Image · Background Image' },
  { value: 'table', label: 'Structural · Table' },
  { value: 'text_input', label: 'Form · Text Input' },
  { value: 'checkbox', label: 'Form · Checkbox' },
];

function getElementStrokeForCategory(cat?: ObjectCategory): string {
  switch (cat) {
    case 'text':
      return '#2563EB';
    case 'vector':
      return '#0D9488';
    case 'image':
      return '#9333EA';
    case 'structural':
      return '#EA580C';
    case 'form':
      return '#DC2626';
    default:
      return '#525252';
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export const ScanInspectorView: React.FC<ScanInspectorViewProps> = ({
  project,
  settings,
  onUpdateProject,
  onInspectInEditor,
}) => {
  const viewport = useViewport();
  const [viewMode, setViewMode] = useState<ScanInspectorMode>('objects');
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(0.85);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<ObjectCategory | 'all'>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceLevel | 'all'>('all');
  const [collapsedTreeIds, setCollapsedTreeIds] = useState<Set<string>>(new Set());
  const [rescanning, setRescanning] = useState(false);
  const [rescanProgress, setRescanProgress] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
    setStatusMessage(null);
  }, [project.id]);

  useEffect(() => {
    setCurrentPage((p) => Math.max(1, Math.min(p, Math.max(1, project.pageCount))));
  }, [project.pageCount]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const pageMeta =
    project.originalPages.find((p) => p.pageNumber === currentPage) ||
    project.originalPages[0];
  const pageWidthPt = pageMeta?.widthPt || project.pageConfig.widthPt || 595.28;
  const pageHeightPt = pageMeta?.heightPt || project.pageConfig.heightPt || 841.89;

  const pageElements = useMemo(
    () => project.elements.filter((e) => e.pageNumber === currentPage),
    [project.elements, currentPage]
  );

  const liveReport = useMemo(() => {
    return (
      project.scanReport ||
      computeScanQualityReport(
        project.elements,
        project.pageCount,
        project.originalPages.reduce((s, p) => s + (p.ocrRegionsCount || 0), 0)
      )
    );
  }, [project.scanReport, project.elements, project.pageCount, project.originalPages]);

  const pageHierarchy = useMemo(() => {
    if (pageMeta?.hierarchy) return pageMeta.hierarchy;
    return reconstructPageRelationshipsAndHierarchy(
      pageElements.filter((e) => e.type !== 'repeated_block'),
      currentPage,
      pageWidthPt,
      pageHeightPt
    ).hierarchy;
  }, [pageMeta?.hierarchy, pageElements, currentPage, pageWidthPt, pageHeightPt]);

  const filteredOverlayElements = useMemo(() => {
    return pageElements.filter((el) => {
      if (viewMode === 'classification' && categoryFilter !== 'all') {
        const cat = el.objectCategory || 'text';
        if (cat !== categoryFilter) return false;
      }
      if (viewMode === 'confidence' && confidenceFilter !== 'all') {
        const lvl =
          el.confidenceLevel || scoreToConfidenceLevel(el.confidence, el.needsReview);
        if (lvl !== confidenceFilter) return false;
      }
      return true;
    });
  }, [pageElements, viewMode, categoryFilter, confidenceFilter]);

  const selectedElements = useMemo(
    () => pageElements.filter((e) => selectedIds.includes(e.id)),
    [pageElements, selectedIds]
  );
  const primaryEl = selectedElements.length === 1 ? selectedElements[0] : null;

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setStatusMessage(null);
    }, 2600);
  };

  const commitScanChanges = (
    nextElements: DocumentElement[],
    nextRules: ScanCorrectionRule[],
    actionLabel: string,
    detail: string
  ) => {
    const pageSubset = nextElements.filter(
      (e) => e.pageNumber === currentPage && e.type !== 'repeated_block'
    );
    const rebuilt = reconstructPageRelationshipsAndHierarchy(
      pageSubset,
      currentPage,
      pageWidthPt,
      pageHeightPt
    );
    const otherPageElements = nextElements.filter(
      (e) => e.pageNumber !== currentPage
    );
    const combinedElements = [...otherPageElements, ...rebuilt.elements];
    const nextOriginalPages = project.originalPages.map((p) =>
      p.pageNumber === currentPage
        ? {
            ...p,
            hierarchy: rebuilt.hierarchy,
            contentBBox: rebuilt.contentBBox,
          }
        : p
    );
    const ocrSum = nextOriginalPages.reduce(
      (s, p) => s + (p.ocrRegionsCount || 0),
      0
    );
    const nextReport = computeScanQualityReport(
      combinedElements,
      project.pageCount,
      ocrSum
    );

    const updated = appendOperationLog(
      {
        ...project,
        elements: combinedElements,
        originalPages: nextOriginalPages,
        scanReport: nextReport,
        scanCorrectionRules: nextRules,
        updatedAt: new Date().toISOString(),
      },
      actionLabel,
      detail,
      currentPage
    );
    onUpdateProject(updated);
  };

  const handleReclassifyElement = (
    targetEl: DocumentElement,
    newSubtype: ObjectClassification,
    actionKind: ScanCorrectionRule['action'] = 'reclassify'
  ) => {
    const mapping = SUBTYPE_TO_TYPE_MAP[newSubtype] || {
      type: targetEl.type,
      category: targetEl.objectCategory || 'text',
    };
    const rule = buildCorrectionRuleFromElement(
      targetEl,
      mapping.type,
      newSubtype,
      actionKind
    );
    const nextRules = [
      ...(project.scanCorrectionRules || []).filter(
        (r) =>
          !(
            r.pageNumber === rule.pageNumber &&
            Math.hypot(r.matchBBox.x - rule.matchBBox.x, r.matchBBox.y - rule.matchBBox.y) < 6
          )
      ),
      rule,
    ];
    const nextElements = project.elements.map((el) =>
      el.id === targetEl.id
        ? {
            ...el,
            type: mapping.type,
            objectCategory: mapping.category,
            objectSubtype: newSubtype,
            isBackgroundImage: newSubtype === 'background_image',
            locked: newSubtype === 'background_image' ? true : el.locked,
            needsReview: false,
            confidence: 1,
            confidenceLevel: 'high' as const,
            relationshipNote: `Manually reclassified as ${newSubtype.replace(/_/g, ' ')}`,
          }
        : el
    );
    commitScanChanges(
      nextElements,
      nextRules,
      'Reclassify Scan Object',
      `Reclassified "${(targetEl.text || targetEl.type).slice(0, 24)}" -> ${newSubtype}`
    );
    showToast(`Saved rule & reclassified as ${newSubtype.replace(/_/g, ' ')}`);
  };

  const handleVerifyElement = (targetEl: DocumentElement) => {
    const nextElements = project.elements.map((el) =>
      el.id === targetEl.id
        ? {
            ...el,
            needsReview: false,
            confidence: Math.max(el.confidence, 0.95),
            confidenceLevel: 'high' as const,
          }
        : el
    );
    commitScanChanges(
      nextElements,
      project.scanCorrectionRules || [],
      'Verify Scan Element',
      `Marked "${(targetEl.text || targetEl.type).slice(0, 24)}" verified`
    );
    showToast('Marked verified');
  };

  const handleConvertSelectionToTable = () => {
    const newTable = convertSelectionToTableElement(selectedElements, currentPage);
    if (!newTable) return;
    const selectedSet = new Set(selectedElements.map((s) => s.id));
    const remaining = project.elements.filter((e) => !selectedSet.has(e.id));
    const nextElements = [...remaining, newTable];
    const rule = buildCorrectionRuleFromElement(
      newTable,
      'table',
      'table',
      'convert_to_table'
    );
    const nextRules = [...(project.scanCorrectionRules || []), rule];
    commitScanChanges(
      nextElements,
      nextRules,
      'Convert Selection to Table',
      `Merged ${selectedElements.length} items into structured table`
    );
    setSelectedIds([newTable.id]);
    showToast(`Created ${newTable.tableData?.rows.length}×${newTable.tableData?.rows[0]?.length} table`);
  };

  const handleMergeLinesToRectangle = () => {
    if (selectedElements.length < 2) return;
    const minX = Math.min(...selectedElements.map((e) => e.x));
    const minY = Math.min(...selectedElements.map((e) => e.y));
    const maxX = Math.max(...selectedElements.map((e) => e.x + e.width));
    const maxY = Math.max(...selectedElements.map((e) => e.y + e.height));
    const mergedId = `el-p${currentPage}-rect-manual-${Date.now().toString(36)}`;
    const first = selectedElements[0];
    const newRect: DocumentElement = {
      id: mergedId,
      type: 'border',
      shapeKind: 'rect',
      pageNumber: currentPage,
      x: Number(minX.toFixed(2)),
      y: Number(minY.toFixed(2)),
      width: Number(Math.max(8, maxX - minX).toFixed(2)),
      height: Number(Math.max(8, maxY - minY).toFixed(2)),
      rotation: 0,
      text: '',
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: first.color || '#111827',
      backgroundColor: 'transparent',
      borderColor: first.borderColor || first.color || '#111827',
      borderWidth: first.borderWidth || 1,
      strokeColor: first.borderColor || first.color || '#111827',
      fillColor: 'transparent',
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: 1,
      confidenceLevel: 'high',
      needsReview: false,
      sourceOrigin: 'original_pdf',
      objectCategory: 'vector',
      objectSubtype: 'border',
      detectionMethod: 'user_manual',
      relationshipNote: `Merged ${selectedElements.length} lines into container border`,
    };
    const selSet = new Set(selectedElements.map((s) => s.id));
    const nextElements = [...project.elements.filter((e) => !selSet.has(e.id)), newRect];
    const rule = buildCorrectionRuleFromElement(newRect, 'border', 'border', 'merge_to_rect');
    commitScanChanges(
      nextElements,
      [...(project.scanCorrectionRules || []), rule],
      'Merge Lines to Border',
      `Merged ${selectedElements.length} primitives into border`
    );
    setSelectedIds([mergedId]);
    showToast('Merged selected lines into rectangle border');
  };

  const handleDetachFromParent = (targetEl: DocumentElement) => {
    const nextElements = project.elements.map((el) => {
      if (el.id === targetEl.id) {
        return { ...el, parentId: undefined, blockId: undefined, groupId: undefined };
      }
      if (el.childIds?.includes(targetEl.id)) {
        return {
          ...el,
          childIds: el.childIds.filter((cid) => cid !== targetEl.id),
        };
      }
      return el;
    });
    commitScanChanges(
      nextElements,
      project.scanCorrectionRules || [],
      'Detach Structural Parent',
      `Detached "${(targetEl.text || targetEl.type).slice(0, 24)}" from container`
    );
    showToast('Detached element from container/group');
  };

  const handleRescanDocument = async () => {
    if (!project.sourcePdfBase64) {
      showToast('No source PDF bytes attached to re-scan.');
      return;
    }
    setRescanning(true);
    setRescanProgress('Initializing Precision Scan Engine 2.0...');
    try {
      const pdfBytes = base64ToBytes(project.sourcePdfBase64);
      const scanResult = await scanPdfLocally(pdfBytes, {
        enableOcr: true,
        ocrLanguage: settings.ocrLanguage,
        renderScale: 1.75,
        maxPages: 25,
        correctionRules: project.scanCorrectionRules || [],
        onProgress: (stage, pct) => {
          setRescanProgress(`${stage} (${pct}%)`);
        },
      });
      const updated = appendOperationLog(
        {
          ...project,
          originalPages: scanResult.originalPages,
          elements: scanResult.elements,
          imageResources: scanResult.imageResources,
          scanReport: scanResult.scanReport,
          documentMetadata: scanResult.documentMetadata,
          aiSummary: scanResult.summary,
          updatedAt: new Date().toISOString(),
        },
        'Re-Scan PDF Locally (Engine 2.0)',
        `Re-scanned with ${(project.scanCorrectionRules || []).length} saved correction rule(s)`
      );
      onUpdateProject(updated);
      setSelectedIds([]);
      showToast('Re-scan complete with correction rules applied');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Re-scan failed');
    } finally {
      setRescanning(false);
      setRescanProgress('');
    }
  };

  const handleExportScanJson = () => {
    const payload = {
      projectName: project.name,
      engineVersion: liveReport.engineVersion,
      scanReport: liveReport,
      documentMetadata: project.documentMetadata,
      pages: project.originalPages.map((p) => ({
        pageNumber: p.pageNumber,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
        rotation: p.rotation,
        boxes: p.boxes,
        embeddedFonts: p.embeddedFonts,
        hasTransparency: p.hasTransparency,
        hierarchy: p.hierarchy,
      })),
      elements: project.elements.map((el) => ({
        ...el,
        imageDataUrl: el.imageDataUrl ? `[image:${el.imageResourceId || el.id}]` : undefined,
      })),
      scanCorrectionRules: project.scanCorrectionRules || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    triggerBlobDownload(blob, `${project.name.replace(/\s+/g, '_')}_scan_structure.json`);
  };

  const toggleTreeCollapse = (nodeId: string) => {
    setCollapsedTreeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const renderHierarchyTree = (node: DocumentHierarchyNode, depth = 0) => {
    const isCollapsed = collapsedTreeIds.has(node.id);
    const hasKids = node.children.length > 0;
    const isSelected = Boolean(node.elementId && selectedIds.includes(node.elementId));

    return (
      <div key={node.id}>
        <div
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          className={`w-full pr-2 py-1 rounded-lg text-left text-[11px] flex items-center gap-1 transition-colors ${
            isSelected
              ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium'
              : 'text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
          }`}
        >
          {hasKids ? (
            <button
              type="button"
              aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
              onClick={() => toggleTreeCollapse(node.id)}
              className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => {
              if (node.elementId) {
                setSelectedIds([node.elementId]);
              } else if (hasKids) {
                toggleTreeCollapse(node.id);
              }
            }}
            className="flex-1 min-w-0 py-0.5 text-left flex items-center gap-1.5"
          >
            <span className="text-[9px] font-mono uppercase opacity-65 shrink-0">
              {node.kind.replace('_', ' ')}
            </span>
            <span className="truncate flex-1">{node.label}</span>
            {node.needsReview && (
              <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
            )}
          </button>
        </div>
        {!isCollapsed && hasKids && (
          <div>{node.children.map((child) => renderHierarchyTree(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const renderOverlayStage = (showPageBg: boolean, showReconstructedFill: boolean) => {
    const displayW = pageWidthPt * zoom;
    const displayH = pageHeightPt * zoom;
    return (
      <div
        style={{ width: displayW, height: displayH }}
        className="relative bg-white shadow-xl border border-black/15 dark:border-white/15 shrink-0 select-none overflow-hidden"
        onClick={() => setSelectedIds([])}
      >
        {showPageBg && pageMeta?.previewImageDataUrl && (
          <img
            src={pageMeta.previewImageDataUrl}
            alt={`Page ${currentPage}`}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
        )}

        {/* Vector & Bounding Overlay */}
        <svg
          width={displayW}
          height={displayH}
          viewBox={`0 0 ${pageWidthPt} ${pageHeightPt}`}
          className="absolute inset-0"
        >
          {filteredOverlayElements.map((el) => {
            const isSel = selectedIds.includes(el.id);
            const catColor = getElementStrokeForCategory(el.objectCategory);
            const stroke = isSel
              ? '#101010'
              : el.needsReview
              ? '#D97706'
              : showReconstructedFill
              ? el.borderColor || el.color || catColor
              : catColor;

            // Render reconstructed editable preview vs inspection bounding outlines
            if (showReconstructedFill) {
              if (el.type === 'repeated_block') return null;
              if ((el.type === 'image' || el.type === 'signature') && el.imageDataUrl) {
                return (
                  <g
                    key={el.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIds([el.id]);
                    }}
                    className="cursor-pointer"
                  >
                    <image
                      href={el.imageDataUrl}
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      opacity={el.opacity ?? 1}
                    />
                    {isSel && (
                      <rect
                        x={el.x}
                        y={el.y}
                        width={el.width}
                        height={el.height}
                        fill="none"
                        stroke="#2563EB"
                        strokeWidth={1.6 / zoom}
                      />
                    )}
                  </g>
                );
              }
              if (el.type === 'line') {
                const pts = el.vectorPath?.points;
                return (
                  <line
                    key={el.id}
                    x1={pts && pts.length >= 4 ? pts[0] : el.x}
                    y1={pts && pts.length >= 4 ? pts[1] : el.y + el.height / 2}
                    x2={pts && pts.length >= 4 ? pts[2] : el.x + el.width}
                    y2={pts && pts.length >= 4 ? pts[3] : el.y + el.height / 2}
                    stroke={el.color || '#111827'}
                    strokeWidth={Math.max(0.8, el.borderWidth || 1)}
                    strokeDasharray={el.dashArray?.join(' ')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIds([el.id]);
                    }}
                    className="cursor-pointer"
                  />
                );
              }
              if (el.type === 'shape' || el.type === 'border') {
                if (el.shapeKind === 'circle' || el.objectSubtype === 'circle' || el.objectSubtype === 'ellipse') {
                  return (
                    <ellipse
                      key={el.id}
                      cx={el.x + el.width / 2}
                      cy={el.y + el.height / 2}
                      rx={Math.max(1, el.width / 2)}
                      ry={Math.max(1, el.height / 2)}
                      fill={
                        el.backgroundColor && el.backgroundColor !== 'transparent'
                          ? el.backgroundColor
                          : 'none'
                      }
                      stroke={el.borderColor || el.strokeColor || el.color || '#111827'}
                      strokeWidth={el.borderWidth ?? 1}
                      strokeDasharray={el.dashArray?.join(' ')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedIds([el.id]);
                      }}
                      className="cursor-pointer"
                    />
                  );
                }
                if (
                  el.vectorPath?.points &&
                  el.vectorPath.points.length >= 6 &&
                  (el.objectSubtype === 'polygon' || el.objectSubtype === 'freeform_path')
                ) {
                  const pts = el.vectorPath.points;
                  const pairs: string[] = [];
                  for (let i = 0; i < pts.length; i += 2) {
                    pairs.push(`${pts[i]},${pts[i + 1]}`);
                  }
                  const Tag = el.vectorPath.isClosed === false ? 'polyline' : 'polygon';
                  return (
                    <Tag
                      key={el.id}
                      points={pairs.join(' ')}
                      fill={
                        Tag === 'polygon' && el.fillColor && el.fillColor !== 'transparent'
                          ? el.fillColor
                          : 'none'
                      }
                      stroke={el.borderColor || el.strokeColor || '#111827'}
                      strokeWidth={el.borderWidth || 1}
                      strokeDasharray={el.dashArray?.join(' ')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedIds([el.id]);
                      }}
                      className="cursor-pointer"
                    />
                  );
                }
                return (
                  <rect
                    key={el.id}
                    x={el.x}
                    y={el.y}
                    width={el.width}
                    height={el.height}
                    rx={el.cornerRadiusPt || 0}
                    ry={el.cornerRadiusPt || 0}
                    fill={
                      el.backgroundColor && el.backgroundColor !== 'transparent'
                        ? el.backgroundColor
                        : 'none'
                    }
                    stroke={el.borderColor || el.color || '#111827'}
                    strokeWidth={el.borderWidth ?? 1}
                    strokeDasharray={el.dashArray?.join(' ')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIds([el.id]);
                    }}
                    className="cursor-pointer"
                  />
                );
              }
            }

            if (viewMode === 'original' && !showReconstructedFill) {
              return null;
            }

            return (
              <g
                key={el.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey) {
                    setSelectedIds((prev) =>
                      prev.includes(el.id)
                        ? prev.filter((id) => id !== el.id)
                        : [...prev, el.id]
                    );
                  } else {
                    setSelectedIds([el.id]);
                  }
                }}
                className="cursor-pointer"
              >
                <rect
                  x={el.x}
                  y={el.y}
                  width={Math.max(2, el.width)}
                  height={Math.max(2, el.height)}
                  rx={el.cornerRadiusPt || 0}
                  fill={
                    isSel
                      ? 'rgba(37, 99, 235, 0.16)'
                      : showReconstructedFill && el.type === 'table'
                      ? 'rgba(234, 88, 12, 0.06)'
                      : 'rgba(16, 16, 16, 0.03)'
                  }
                  stroke={stroke}
                  strokeWidth={(isSel ? 2 : 1) / zoom}
                  strokeDasharray={
                    el.needsReview || el.type === 'repeated_block'
                      ? `${4 / zoom} ${2 / zoom}`
                      : undefined
                  }
                />
                {showReconstructedFill && el.text && el.type !== 'table' && (
                  <text
                    x={el.x + 1}
                    y={el.y + Math.min(el.height, el.fontSize * 0.9)}
                    fontFamily={el.fontFamily || 'Helvetica, Arial, sans-serif'}
                    fontSize={Math.max(6, el.fontSize)}
                    fontWeight={el.fontWeight}
                    fontStyle={el.fontStyle || 'normal'}
                    fill={el.color || '#111827'}
                    transform={
                      el.rotation
                        ? `rotate(${el.rotation} ${el.x + el.width / 2} ${el.y + el.height / 2})`
                        : undefined
                    }
                  >
                    {el.text}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header Toolbar */}
      <div className="px-4 tablet:px-6 py-3.5 border-b border-black/10 dark:border-white/12 glass-level-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ScanSearch className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
            <h1 className="text-base tablet:text-lg font-display font-semibold text-[#101010] dark:text-white truncate">
              Scan Inspector · Precision Engine {liveReport.engineVersion}
            </h1>
          </div>
          <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5] truncate">
            {project.name} · Inspect multi-pass geometry, object classification, hierarchy &amp; template correction rules
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GlassButton
            size="sm"
            variant="glass"
            disabled={rescanning || !project.sourcePdfBase64}
            onClick={() => void handleRescanDocument()}
          >
            {rescanning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {rescanning ? 'Scanning...' : 'Re-Scan Locally'}
          </GlassButton>
          <GlassButton size="sm" variant="glass" onClick={handleExportScanJson}>
            <Download className="w-3.5 h-3.5" />
            Scan JSON
          </GlassButton>
          <GlassButton
            size="sm"
            variant="primary"
            onClick={() => onInspectInEditor(currentPage, primaryEl?.id)}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Editor
          </GlassButton>
        </div>
      </div>

      {/* Scan Quality Report Strip */}
      <div className="px-4 tablet:px-6 py-2.5 border-b border-black/10 dark:border-white/10 glass-level-1 grid grid-cols-4 tablet:grid-cols-8 gap-2 text-[11px] tabular-nums shrink-0">
        <div className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div className="text-[#888888] dark:text-[#858585]">Text</div>
          <div className="font-semibold text-[#101010] dark:text-white">{liveReport.textObjects}</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div className="text-[#888888] dark:text-[#858585]">Images</div>
          <div className="font-semibold text-[#101010] dark:text-white">{liveReport.imageObjects}</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div className="text-[#888888] dark:text-[#858585]">Rectangles</div>
          <div className="font-semibold text-[#101010] dark:text-white">{liveReport.rectangles}</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div className="text-[#888888] dark:text-[#858585]">Lines</div>
          <div className="font-semibold text-[#101010] dark:text-white">{liveReport.lines}</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div className="text-[#888888] dark:text-[#858585]">Tables</div>
          <div className="font-semibold text-[#101010] dark:text-white">
            {liveReport.tables} ({liveReport.tableCells} cells)
          </div>
        </div>
        <div className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div className="text-[#888888] dark:text-[#858585]">Forms</div>
          <div className="font-semibold text-[#101010] dark:text-white">{liveReport.formFields}</div>
        </div>
        <div className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div className="text-[#888888] dark:text-[#858585]">OCR Regions</div>
          <div className="font-semibold text-[#101010] dark:text-white">{liveReport.ocrRegions}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setViewMode('confidence');
            setConfidenceFilter('needs_review');
          }}
          className="px-2.5 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.07] dark:hover:bg-white/[0.08] text-left transition-colors"
        >
          <div className="text-[#888888] dark:text-[#858585]">Needs Review</div>
          <div
            className={`font-semibold ${
              liveReport.needsReviewObjects > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-[#101010] dark:text-white'
            }`}
          >
            {liveReport.needsReviewObjects} ({liveReport.lowConfidenceObjects} low)
          </div>
        </button>
      </div>

      {/* Mode Switcher & Page/Zoom Controls */}
      <div className="px-4 tablet:px-6 py-2 border-b border-black/10 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {(
            [
              ['original', 'Original PDF', Eye],
              ['objects', 'Detected Objects', Box],
              ['classification', 'Classification', Sliders],
              ['tree', 'Structure Tree', FolderTree],
              ['confidence', 'Confidence & Review', ShieldAlert],
              ['side_by_side', 'Side-by-Side', Columns2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewMode(id)}
              className={`px-2.5 py-1.5 rounded-xl font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                viewMode === id
                  ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505]'
                  : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {rescanProgress && (
            <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              {rescanProgress}
            </span>
          )}
          {statusMessage && (
            <span className="px-2.5 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] text-[11px] font-medium">
              {statusMessage}
            </span>
          )}
          <div className="flex items-center gap-1 border border-black/15 dark:border-white/15 rounded-xl px-1.5 py-0.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => {
                setCurrentPage((p) => Math.max(1, p - 1));
                setSelectedIds([]);
              }}
              className="p-1 disabled:opacity-35"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] tabular-nums px-1">
              P{currentPage}/{project.pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= project.pageCount}
              onClick={() => {
                setCurrentPage((p) => Math.min(project.pageCount, p + 1));
                setSelectedIds([]);
              }}
              className="p-1 disabled:opacity-35"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1 border border-black/15 dark:border-white/15 rounded-xl px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.1).toFixed(2))))}
              className="p-1"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] tabular-nums w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2, Number((z + 0.1).toFixed(2))))}
              className="p-1"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Body */}
      <div className="flex-1 flex flex-col desktop:flex-row min-h-0 overflow-hidden">
        {/* Left Context Rail (Classification filters / Structure Tree / Uncertain Queue) */}
        {(viewMode === 'classification' ||
          viewMode === 'tree' ||
          viewMode === 'confidence' ||
          viewMode === 'original') && (
          <aside className="w-full desktop:w-72 shrink-0 border-b desktop:border-b-0 desktop:border-r border-black/10 dark:border-white/12 glass-level-2 overflow-y-auto p-3 max-h-60 desktop:max-h-none">
            {viewMode === 'original' && (
              <div className="space-y-3 text-xs">
                <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
                  <FileCode2 className="w-3.5 h-3.5" />
                  Pass 1 Page Inspection (P{currentPage})
                </div>
                <div className="space-y-1.5 text-[11px] font-mono tabular-nums">
                  <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="text-[#888888]">MediaBox</div>
                    <div>
                      {pageMeta?.boxes?.mediaBox
                        ? `${pageMeta.boxes.mediaBox.width.toFixed(1)} × ${pageMeta.boxes.mediaBox.height.toFixed(1)} pt`
                        : `${pageWidthPt.toFixed(1)} × ${pageHeightPt.toFixed(1)} pt`}
                    </div>
                  </div>
                  {pageMeta?.boxes?.cropBox && (
                    <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
                      <div className="text-[#888888]">CropBox</div>
                      <div>
                        {pageMeta.boxes.cropBox.x.toFixed(1)}, {pageMeta.boxes.cropBox.y.toFixed(1)} · {pageMeta.boxes.cropBox.width.toFixed(1)}×{pageMeta.boxes.cropBox.height.toFixed(1)}
                      </div>
                    </div>
                  )}
                  {pageMeta?.boxes?.bleedBox && (
                    <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
                      <div className="text-[#888888]">BleedBox / TrimBox</div>
                      <div>
                        {pageMeta.boxes.bleedBox.width.toFixed(1)} × {pageMeta.boxes.bleedBox.height.toFixed(1)} pt
                      </div>
                    </div>
                  )}
                  <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="text-[#888888]">Rotation / Transparency</div>
                    <div>
                      {pageMeta?.rotation ?? 0}° · {pageMeta?.hasTransparency ? 'Alpha / ExtGState' : 'Opaque'} · {pageMeta?.streamCount ?? 1} stream(s)
                    </div>
                  </div>
                  <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
                    <div className="text-[#888888]">Embedded Font Resources ({pageMeta?.embeddedFonts?.length || 0})</div>
                    <div className="mt-1 space-y-0.5 text-[10px] break-all">
                      {(pageMeta?.embeddedFonts || []).length > 0
                        ? pageMeta!.embeddedFonts!.map((f) => <div key={f}>{f}</div>)
                        : 'Standard PDF Base-14 Fonts'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {viewMode === 'classification' && (
              <div className="space-y-3 text-xs">
                <div className="font-semibold text-[#101010] dark:text-white">
                  Filter by Object Category
                </div>
                <div className="space-y-1">
                  {(
                    [
                      ['all', 'All Objects', Layers, pageElements.length],
                      ['text', 'Text Objects', TypeIcon, pageElements.filter((e) => (e.objectCategory || 'text') === 'text').length],
                      ['vector', 'Vector Paths & Lines', Box, pageElements.filter((e) => e.objectCategory === 'vector').length],
                      ['image', 'Images & Logos', ImageIcon, pageElements.filter((e) => e.objectCategory === 'image').length],
                      ['structural', 'Tables & Blocks', Table2, pageElements.filter((e) => e.objectCategory === 'structural').length],
                      ['form', 'Form Fields', Sliders, pageElements.filter((e) => e.objectCategory === 'form').length],
                    ] as const
                  ).map(([cat, label, Icon, count]) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between text-xs transition-colors ${
                        categoryFilter === cat
                          ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium'
                          : 'text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {viewMode === 'tree' && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-[#101010] dark:text-white">
                  Document Structure Tree
                </div>
                <div className="space-y-0.5">{renderHierarchyTree(pageHierarchy)}</div>
              </div>
            )}

            {viewMode === 'confidence' && (
              <div className="space-y-3 text-xs">
                <div className="font-semibold text-[#101010] dark:text-white">
                  Confidence &amp; Review Queue
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['all', 'All'],
                      ['needs_review', 'Review'],
                      ['low', 'Low'],
                      ['medium', 'Medium'],
                      ['high', 'High'],
                    ] as const
                  ).map(([lvl, label]) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setConfidenceFilter(lvl)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                        confidenceFilter === lvl
                          ? 'bg-[#101010] text-white border-black dark:bg-white dark:text-[#050505] dark:border-white'
                          : 'border-black/12 dark:border-white/12 text-[#555555] dark:text-[#B5B5B5]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5 pt-2 border-t border-black/10 dark:border-white/10">
                  <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                    Uncertain Detections ({liveReport.uncertainTargets.length})
                  </div>
                  {liveReport.uncertainTargets.length === 0 ? (
                    <div className="p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] text-[11px] flex items-center gap-1.5 text-[#555555] dark:text-[#B5B5B5]">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      All detected elements passed confidence checks.
                    </div>
                  ) : (
                    liveReport.uncertainTargets.map((item) => (
                      <button
                        key={item.elementId}
                        type="button"
                        onClick={() => {
                          setCurrentPage(item.pageNumber);
                          setSelectedIds([item.elementId]);
                        }}
                        className={`w-full p-2 rounded-xl border text-left transition-colors ${
                          selectedIds.includes(item.elementId)
                            ? 'border-[#101010] dark:border-white bg-black/[0.06] dark:bg-white/[0.08]'
                            : 'border-black/10 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 text-[11px] font-semibold text-[#101010] dark:text-white">
                          <span className="truncate">{item.label}</span>
                          <span className="font-mono text-[10px] shrink-0">
                            P{item.pageNumber} · {Math.round(item.confidence * 100)}%
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                          {item.reason}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* Center Visual Stage */}
        <div className="flex-1 overflow-auto bg-[#EFEFEF] dark:bg-[#0B0B0B] p-4 tablet:p-6 flex items-start justify-center gap-6">
          {viewMode === 'side_by_side' ? (
            <div className="flex flex-col desktop:flex-row items-start gap-6">
              <div>
                <div className="mb-2 text-[11px] font-semibold text-[#555555] dark:text-[#B5B5B5]">
                  Original Rendered PDF (Page {currentPage})
                </div>
                {renderOverlayStage(true, false)}
              </div>
              <div>
                <div className="mb-2 text-[11px] font-semibold text-[#555555] dark:text-[#B5B5B5]">
                  Reconstructed Editable Objects ({pageElements.length})
                </div>
                {renderOverlayStage(false, true)}
              </div>
            </div>
          ) : (
            renderOverlayStage(true, false)
          )}
        </div>

        {/* Right Inspection & Manual Correction Panel */}
        <aside className="w-full desktop:w-80 shrink-0 border-t desktop:border-t-0 desktop:border-l border-black/10 dark:border-white/12 glass-level-2 overflow-y-auto p-4 space-y-4 text-xs max-h-72 desktop:max-h-none">
          {selectedElements.length === 0 && (
            <div className="space-y-3">
              <div className="font-semibold text-[#101010] dark:text-white">
                Object Inspector &amp; Corrections
              </div>
              <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                Click any object on the canvas or in the Structure Tree to inspect its PDF operator provenance, bounding box, transform matrix, or save a manual reclassification rule. Hold Shift+Click to multi-select items to convert into a table or merge lines into a rectangle.
              </p>
              {(project.scanCorrectionRules?.length || 0) > 0 && (
                <GlassCard level={3} padding="sm" className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-[#101010] dark:text-white">
                    Saved Template Correction Rules ({project.scanCorrectionRules!.length})
                  </div>
                  {project.scanCorrectionRules!.slice(-5).map((r) => (
                    <div key={r.id} className="text-[10px] text-[#555555] dark:text-[#B5B5B5] truncate">
                      P{r.pageNumber}: {r.originalSubtype || r.originalType} → {r.targetSubtype}
                    </div>
                  ))}
                </GlassCard>
              )}
            </div>
          )}

          {selectedElements.length >= 2 && (
            <div className="space-y-3">
              <div className="font-semibold text-[#101010] dark:text-white">
                {selectedElements.length} Objects Selected
              </div>
              <button
                type="button"
                onClick={handleConvertSelectionToTable}
                className="w-full py-2 px-3 rounded-xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium flex items-center justify-center gap-1.5"
              >
                <Table2 className="w-3.5 h-3.5" />
                Convert Selection to Table
              </button>
              <button
                type="button"
                onClick={handleMergeLinesToRectangle}
                className="w-full py-2 px-3 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] font-medium flex items-center justify-center gap-1.5"
              >
                <Box className="w-3.5 h-3.5" />
                Merge Lines into Rectangle Border
              </button>
            </div>
          )}

          {primaryEl && (
            <div className="space-y-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-[#101010] dark:text-white capitalize">
                    {(primaryEl.objectSubtype || primaryEl.type).replace(/_/g, ' ')}
                  </div>
                  <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    {primaryEl.objectCategory || 'text'} · {primaryEl.detectionMethod || 'pdf_operator'}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-lg bg-black/[0.06] dark:bg-white/[0.08] font-mono text-[10px] tabular-nums">
                  {Math.round(primaryEl.confidence * 100)}%
                </span>
              </div>

              {primaryEl.needsReview && (
                <button
                  type="button"
                  onClick={() => handleVerifyElement(primaryEl)}
                  className="w-full py-1.5 px-3 rounded-xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  Mark Verified
                </button>
              )}

              {/* Extracted Image Preview */}
              {(primaryEl.type === 'image' || primaryEl.type === 'signature') &&
                primaryEl.imageDataUrl && (
                  <div className="p-2 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] space-y-1.5">
                    <img
                      src={primaryEl.imageDataUrl}
                      alt="Extracted Resource"
                      className="max-h-28 mx-auto object-contain rounded"
                    />
                    <div className="text-[10px] font-mono text-[#555555] dark:text-[#B5B5B5] text-center tabular-nums">
                      {primaryEl.imageNaturalWidth}×{primaryEl.imageNaturalHeight}px
                      {primaryEl.effectiveDpi ? ` · ${primaryEl.effectiveDpi} DPI` : ''}
                    </div>
                  </div>
                )}

              {/* Reclassify Controls (Saved as persistent template rules) */}
              <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-2">
                <div className="text-[11px] font-semibold text-[#101010] dark:text-white">
                  Manual Reclassification (Persists on Re-Scan)
                </div>
                <select
                  value={primaryEl.objectSubtype || 'text'}
                  onChange={(e) =>
                    handleReclassifyElement(
                      primaryEl,
                      e.target.value as ObjectClassification
                    )
                  }
                  className="w-full px-2.5 py-1.5 rounded-xl border studio-select text-xs"
                >
                  {RECLASSIFY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {(primaryEl.type === 'image' || primaryEl.type === 'signature') && (
                  <button
                    type="button"
                    onClick={() =>
                      handleReclassifyElement(
                        primaryEl,
                        'background_image',
                        'mark_background'
                      )
                    }
                    className="w-full py-1.5 px-2.5 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[11px] font-medium"
                  >
                    Mark as Background Image &amp; Lock
                  </button>
                )}
                {(primaryEl.parentId || primaryEl.blockId || primaryEl.groupId) && (
                  <button
                    type="button"
                    onClick={() => handleDetachFromParent(primaryEl)}
                    className="w-full py-1.5 px-2.5 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[11px] font-medium flex items-center justify-center gap-1.5"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    Detach from Container / Group
                  </button>
                )}
              </div>

              {/* Source Geometry & Transform Matrix */}
              <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-1.5 text-[10px] font-mono tabular-nums">
                <div className="font-sans text-[11px] font-semibold text-[#101010] dark:text-white">
                  Source Geometry &amp; Provenance
                </div>
                <div>
                  BBox: x={primaryEl.x.toFixed(1)}, y={primaryEl.y.toFixed(1)}, w={primaryEl.width.toFixed(1)}, h={primaryEl.height.toFixed(1)} pt
                </div>
                {primaryEl.baselineY !== undefined && (
                  <div>Baseline Y: {primaryEl.baselineY.toFixed(2)} pt</div>
                )}
                {primaryEl.transformMatrix && (
                  <div>
                    CTM: [{primaryEl.transformMatrix.map((n) => Number(n.toFixed(2))).join(', ')}]
                  </div>
                )}
                {primaryEl.vectorPath && (
                  <div>
                    Path: {primaryEl.vectorPath.commands.length} ops ·{' '}
                    {primaryEl.vectorPath.isClosed ? 'closed' : 'open'}
                    {primaryEl.vectorPath.lineRole ? ` · role=${primaryEl.vectorPath.lineRole}` : ''}
                    {primaryEl.cornerRadiusPt ? ` · r=${primaryEl.cornerRadiusPt}pt` : ''}
                  </div>
                )}
                {primaryEl.relationshipNote && (
                  <div className="font-sans text-[11px] text-[#555555] dark:text-[#B5B5B5] pt-1">
                    {primaryEl.relationshipNote}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
