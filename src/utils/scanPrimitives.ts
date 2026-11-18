import {
  ExtractedImageResource,
  RectPt,
  VectorPathCommand,
} from '../types/pdfStudio';
import { InspectedAnnotation, InspectedFormWidget } from './pdfStructureInspector';

export interface RawTextRun {
  id: string;
  pageNumber: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baselineY: number;
  rotation: number;
  transformMatrix: [number, number, number, number, number, number];
  fontName: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  charSpacingPt?: number;
  wordSpacingPt?: number;
  hasEOL?: boolean;
  confidence: number;
  sourceOrigin: 'original_pdf' | 'scanned_ocr';
  originalObjectRef?: string;
  zOrder: number;
}

export interface RawVectorPath {
  id: string;
  pageNumber: number;
  commands: VectorPathCommand[];
  points: number[]; // sampled / vertex flat array [x0, y0, x1, y1, ...] in top-left pt
  bbox: RectPt;
  isClosed: boolean;
  isFilled: boolean;
  isStroked: boolean;
  isClippingPath: boolean;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth: number;
  dashArray: number[];
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  opacity: number;
  transformMatrix: [number, number, number, number, number, number];
  zOrder: number;
  originalObjectRef?: string;
}

export interface RawImagePlacement {
  id: string;
  pageNumber: number;
  resourceId: string;
  sourceXObjectName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  transformMatrix: [number, number, number, number, number, number];
  naturalWidth: number;
  naturalHeight: number;
  hasAlpha: boolean;
  hasMask: boolean;
  isInlineImage: boolean;
  isImageMask: boolean;
  zOrder: number;
  originalObjectRef?: string;
}

export interface RawPageScanInput {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
  textRuns: RawTextRun[];
  vectorPaths: RawVectorPath[];
  imagePlacements: RawImagePlacement[];
  imageResources: Record<string, ExtractedImageResource>;
  annotations: InspectedAnnotation[];
  formWidgets: InspectedFormWidget[];
  ocrRegionsCount: number;
}
