export type NavSection =
  | 'dashboard'
  | 'new-project'
  | 'templates'
  | 'editor'
  | 'bulk-generator'
  | 'data-manager'
  | 'preflight'
  | 'compare'
  | 'batch-center'
  | 'asset-library'
  | 'export-center'
  | 'settings'
  | 'about';

export type MeasurementUnit = 'pt' | 'mm' | 'cm' | 'in' | 'px';

export type PageOrientation = 'portrait' | 'landscape' | 'custom';

export type PageSizePreset =
  | 'A0'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'Letter'
  | 'Legal'
  | 'Tabloid'
  | 'Executive'
  | 'Custom';

export type ElementType =
  | 'heading'
  | 'text'
  | 'invoice_number'
  | 'receipt_number'
  | 'table'
  | 'image'
  | 'shape'
  | 'line'
  | 'border'
  | 'form_field'
  | 'repeated_block';

export interface TableElementData {
  rows: string[][];
  headerRow: boolean;
  borderColor: string;
  headerBgColor: string;
  cellPadding: number;
}

export interface DocumentElement {
  id: string;
  type: ElementType;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  backgroundColor: string;
  borderColor?: string;
  borderWidth?: number;
  align: 'left' | 'center' | 'right';
  opacity: number;
  editable: boolean;
  locked: boolean;
  visible: boolean;
  groupId?: string;
  blockId?: string;
  confidence: number;
  needsReview: boolean;
  reviewReason?: string;
  fieldKey?: string;
  eraseOriginal?: boolean;
  sourceOriginalRect?: { x: number; y: number; width: number; height: number };
  imageDataUrl?: string;
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
  shapeKind?: 'rect' | 'circle' | 'line';
  tableData?: TableElementData;
  relationshipNote?: string;
  isUserAdded?: boolean;
}

export interface RectPt {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BoundaryMode =
  | 'original_page'
  | 'auto_content'
  | 'manual_selection'
  | 'custom_crop';

export type ScalingMode =
  | 'auto_fit_aspect'
  | 'fit_to_page'
  | 'fit_to_width'
  | 'fit_to_height'
  | 'fit_to_cell'
  | 'fill_cell'
  | 'preserve_original'
  | 'custom_percent';

export interface SourceFitConfig {
  boundaryMode: BoundaryMode;
  scalingMode: ScalingMode;
  customPercent: number;
  customCropRect?: RectPt;
  manualBoundsRect?: RectPt;
  cropPaddingPt: number;
  preserveIntentionalWhitespace: boolean;
}

export interface SlotOverride {
  scale?: number;
  rotation?: 0 | 90 | 180 | 270;
  xOffsetPt?: number;
  yOffsetPt?: number;
}

export interface DetectedPageBounds {
  textBBox?: RectPt;
  vectorBBox?: RectPt;
  imageBBox?: RectPt;
  contentBBox: RectPt;
  whitespaceInsetsPt: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  blockBoxes: Array<{ blockId: string; rect: RectPt }>;
}

export interface CustomPaperPreset {
  id: string;
  name: string;
  widthPt: number;
  heightPt: number;
  unit: MeasurementUnit;
  orientation: PageOrientation;
  marginTopPt?: number;
  marginBottomPt?: number;
  marginLeftPt?: number;
  marginRightPt?: number;
  horizontalSpacingPt?: number;
  verticalSpacingPt?: number;
  bleedPt?: number;
  cropMarks?: boolean;
  backgroundColor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageConfig {
  sizePreset: PageSizePreset;
  orientation: PageOrientation;
  widthPt: number;
  heightPt: number;
  unit: MeasurementUnit;
  marginTopPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  marginRightPt: number;
  bleedPt?: number;
  cropMarks?: boolean;
  backgroundColor: string;
  rotation: 0 | 90 | 180 | 270;
  customPresetId?: string;
  customPresetName?: string;
}

export interface CopiesPerPageConfig {
  enabled: boolean;
  copiesPreset: 1 | 2 | 3 | 4 | 6 | 8 | 9 | 12 | 'custom';
  columns: number;
  rows: number;
  horizontalSpacingPt: number;
  verticalSpacingPt: number;
  outerMarginTopPt: number;
  outerMarginRightPt: number;
  outerMarginBottomPt: number;
  outerMarginLeftPt: number;
  copyScale: number;
  copyRotation: 0 | 90 | 180 | 270;
  fitToPage: boolean;
  positioningMode: 'auto' | 'manual';
  manualOffsets: Array<{ xPt: number; yPt: number }>;
  slotOverrides?: Record<number, SlotOverride>;
  cropMarks: boolean;
  cuttingGuides: boolean;
  showBorders: boolean;
  allowOverlapOrOverflow: boolean;
  sourceScope: 'full_page' | 'selected_block';
  selectedBlockId?: string;
}

export interface SerialSequenceRule {
  id: string;
  name: string;
  targetFieldKey: string;
  blockIndex: number;
  mode: 'auto' | 'manual' | 'csv' | 'repeating';
  startNumber: number;
  endNumber: number;
  increment: number;
  prefix: string;
  suffix: string;
  digits: number;
  leadingZeros: boolean;
  repeatCount: number;
  csvColumn?: string;
  customPattern?: string;
  manualValues?: string[];
}

export interface BulkConfig {
  enabled: boolean;
  totalOutputPages: number;
  copiesPerPage: number;
  totalRecords: number;
  startPageNumber: number;
  endPageNumber: number;
  documentBlocksCount: number;
  copiesPerDocument: number;
  dataSourceMode: 'serial_only' | 'dataset' | 'hybrid';
}

export interface ConditionalFieldRule {
  id: string;
  whenColumn: string;
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'gt'
    | 'lt'
    | 'is_empty'
    | 'not_empty';
  compareValue: string;
  thenValue: string;
  elseValue?: string;
}

export interface DataColumn {
  id: string;
  name: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'formula';
  currencySymbol?: string;
  dateFormat?: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'MMM D, YYYY';
  numberDecimals?: number;
  formula?: string;
  required?: boolean;
  conditionRules?: ConditionalFieldRule[];
}

export interface DataRow {
  _rowId: string;
  [columnKey: string]: string | number;
}

export interface DataQualityReport {
  duplicates: Array<{
    key: string;
    rowIds: string[];
    rowIndices: number[];
  }>;
  missingValues: Array<{
    rowId: string;
    rowIndex: number;
    columnName: string;
  }>;
  totalIssues: number;
}

export type ExportMode =
  | 'standard'
  | 'high_quality'
  | 'print_ready'
  | 'flattened'
  | 'editable'
  | 'individual_pages'
  | 'separate_documents'
  | 'merge'
  | 'compress'
  | 'selected_pages';

export interface ExportConfig {
  mode: ExportMode;
  dpi: 72 | 150 | 300 | 600;
  imageCompression: 'none' | 'medium' | 'high';
  embedFonts: boolean;
  addPageNumbers: boolean;
  pageNumberFormat: string;
  watermarkText: string;
  watermarkOpacity: number;
  passwordProtect: boolean;
  userPassword: string;
  cropMarks: boolean;
  bleedPt: number;
  selectedPagesRange: string;
  customWidthPt?: number;
  customHeightPt?: number;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  category:
    | 'text_overflow'
    | 'overlap'
    | 'missing_field'
    | 'serial_error'
    | 'duplicate_serial'
    | 'page_dimensions'
    | 'out_of_bounds'
    | 'misaligned_block'
    | 'missing_image'
    | 'image_resolution'
    | 'font_substitution'
    | 'missing_font'
    | 'font_license'
    | 'layout_drift'
    | 'clipping';
  message: string;
  detail?: string;
  elementId?: string;
  pageNumber?: number;
  effectiveDpi?: number;
  autoFixLabel?: string;
}

export interface OriginalPageMeta {
  pageNumber: number;
  sourcePdfPageNumber?: number;
  widthPt: number;
  heightPt: number;
  orientation: 'portrait' | 'landscape';
  previewImageDataUrl?: string;
  contentBBox?: RectPt;
  detectedBounds?: DetectedPageBounds;
}

export interface ProjectVersionSnapshot {
  version: number;
  savedAt: string;
  note: string;
  isAutoSnapshot?: boolean;
  elementsSnapshot: DocumentElement[];
  pageConfigSnapshot: PageConfig;
  fitConfigSnapshot?: SourceFitConfig;
  copiesConfigSnapshot?: CopiesPerPageConfig;
}

export interface DocumentOperationLog {
  id: string;
  timestamp: string;
  action: string;
  detail: string;
  pageNumber?: number;
}

export interface UnsavedDraftRecord {
  projectId: string;
  projectName: string;
  savedAt: string;
  projectSnapshot: PDFProject;
  dirty: boolean;
}

export interface PDFProject {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  sourcePdfName: string;
  sourcePdfBase64?: string;
  pageCount: number;
  originalPages: OriginalPageMeta[];
  elements: DocumentElement[];
  pageConfig: PageConfig;
  fitConfig?: SourceFitConfig;
  copiesConfig: CopiesPerPageConfig;
  serialRules: SerialSequenceRule[];
  bulkConfig: BulkConfig;
  dataColumns: DataColumn[];
  dataRows: DataRow[];
  exportConfig: ExportConfig;
  aiSummary?: string;
  isTemplate: boolean;
  isFavorite?: boolean;
  versions: ProjectVersionSnapshot[];
  operationLog?: DocumentOperationLog[];
}

export interface TemplateAutomationProfile {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  sourcePdfName: string;
  sourcePdfBase64?: string;
  pageCount: number;
  originalPages: OriginalPageMeta[];
  elements: DocumentElement[];
  blockBoundaries: Array<{ blockId: string; pageNumber: number; rect: RectPt }>;
  pageConfig: PageConfig;
  fitConfig: SourceFitConfig;
  copiesConfig: CopiesPerPageConfig;
  serialRules: SerialSequenceRule[];
  bulkConfig: BulkConfig;
  dataColumns: DataColumn[];
  fieldMappings: Array<{ elementId: string; label: string; fieldKey: string }>;
  fontSettings: {
    defaultFontFamily: string;
    embedFonts: boolean;
  };
  exportConfig: ExportConfig;
}

export interface BatchJob {
  id: string;
  projectId: string;
  projectName: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progressCurrent: number;
  progressTotal: number;
  stage: string;
  outputFileName?: string;
  outputMimeType?: string;
  outputSizeBytes?: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AssetFontItem {
  id: string;
  kind: 'font';
  name: string;
  fontFamily: string;
  format: 'ttf' | 'otf' | 'woff';
  dataBase64: string;
  fsType?: number;
  embeddingPermission:
    | 'installable'
    | 'editable'
    | 'preview_print'
    | 'restricted_bitmap'
    | 'unknown';
  canEmbedInPdf: boolean;
  licenseNote?: string;
  createdAt: string;
}

export interface AssetImageItem {
  id: string;
  kind: 'image' | 'logo';
  name: string;
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  createdAt: string;
}

export interface AssetShapeItem {
  id: string;
  kind: 'shape';
  name: string;
  shapeKind: 'rect' | 'circle' | 'line';
  width: number;
  height: number;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  opacity: number;
  createdAt: string;
}

export interface AssetTextStyleItem {
  id: string;
  kind: 'text_style';
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  backgroundColor: string;
  align: 'left' | 'center' | 'right';
  createdAt: string;
}

export interface AssetPaletteItem {
  id: string;
  kind: 'palette';
  name: string;
  colors: string[];
  createdAt: string;
}

export type AssetLibraryItem =
  | AssetFontItem
  | AssetImageItem
  | AssetShapeItem
  | AssetTextStyleItem
  | AssetPaletteItem;

export type WorkspaceLayoutMode = 'standard' | 'compact' | 'wide-canvas';

export type ShortcutActionId =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'group'
  | 'lock'
  | 'selectAll'
  | 'zoomIn'
  | 'zoomOut'
  | 'saveSnapshot'
  | 'nudgeUp'
  | 'nudgeDown'
  | 'nudgeLeft'
  | 'nudgeRight';

export interface StudioSettings {
  theme: 'dark' | 'light' | 'system';
  defaultUnit: MeasurementUnit;
  defaultPagePreset: PageSizePreset;
  gridSizePt: number;
  snapThresholdPt: number;
  snapToObjects?: boolean;
  duplicateOffsetXPt?: number;
  duplicateOffsetYPt?: number;
  showRulersByDefault: boolean;
  showGridByDefault: boolean;
  ocrLanguage: string;
  autoRunQcBeforeExport: boolean;
  workspaceLayout?: WorkspaceLayoutMode;
  navSidebarWidthPx?: number;
  layersPanelWidthPx?: number;
  inspectorWidthPx?: number;
  hiddenEditorTools?: string[];
  recentTools?: string[];
  shortcuts?: Record<ShortcutActionId, string>;
  autoSnapshotIntervalSec?: number;
}

export interface AiEditOperation {
  action: 'update' | 'create' | 'delete' | 'duplicate';
  targetId?: string;
  reason: string;
  patch?: Partial<DocumentElement>;
  newElement?: Partial<DocumentElement>;
}

export interface AiEditPlan {
  summary: string;
  requiresConfirmation: boolean;
  impactDescription: string;
  operations: AiEditOperation[];
}
