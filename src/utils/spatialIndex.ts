import { RectPt } from '../types/pdfStudio';

export interface SpatialBBoxItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Uniform grid spatial index for fast O(1)/O(k) bounding box intersection and
 * containment queries across large PDFs with thousands of primitives.
 */
export class SpatialBBoxIndex<T extends SpatialBBoxItem> {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, T[]>();
  private readonly items: T[] = [];

  constructor(cellSizePt = 48) {
    this.cellSize = Math.max(8, cellSizePt);
  }

  private getCellBounds(rect: RectPt) {
    const minCx = Math.floor(rect.x / this.cellSize);
    const maxCx = Math.floor((rect.x + Math.max(0.1, rect.width)) / this.cellSize);
    const minCy = Math.floor(rect.y / this.cellSize);
    const maxCy = Math.floor((rect.y + Math.max(0.1, rect.height)) / this.cellSize);
    return { minCx, maxCx, minCy, maxCy };
  }

  insert(item: T): void {
    this.items.push(item);
    const { minCx, maxCx, minCy, maxCy } = this.getCellBounds(item);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = `${cx}:${cy}`;
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = [];
          this.buckets.set(key, bucket);
        }
        bucket.push(item);
      }
    }
  }

  insertAll(items: T[]): void {
    for (const item of items) {
      this.insert(item);
    }
  }

  queryIntersecting(rect: RectPt, paddingPt = 0): T[] {
    const q: RectPt = {
      x: rect.x - paddingPt,
      y: rect.y - paddingPt,
      width: rect.width + paddingPt * 2,
      height: rect.height + paddingPt * 2,
    };
    const { minCx, maxCx, minCy, maxCy } = this.getCellBounds(q);
    const seen = new Set<string>();
    const results: T[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(`${cx}:${cy}`);
        if (!bucket) continue;
        for (const item of bucket) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (rectsOverlap(q, item)) {
            results.push(item);
          }
        }
      }
    }
    return results;
  }

  queryContained(container: RectPt, tolerancePt = 2): T[] {
    const candidates = this.queryIntersecting(container, tolerancePt);
    return candidates.filter(
      (item) =>
        item.x >= container.x - tolerancePt &&
        item.y >= container.y - tolerancePt &&
        item.x + item.width <= container.x + container.width + tolerancePt &&
        item.y + item.height <= container.y + container.height + tolerancePt
    );
  }

  getAll(): T[] {
    return this.items;
  }
}

export function rectsOverlap(a: RectPt, b: RectPt, tol = 0): boolean {
  return !(
    a.x + a.width + tol < b.x ||
    b.x + b.width + tol < a.x ||
    a.y + a.height + tol < b.y ||
    b.y + b.height + tol < a.y
  );
}

export function rectArea(r: RectPt): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

export function rectIntersectionArea(a: RectPt, b: RectPt): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.width, b.x + b.width);
  const iy2 = Math.min(a.y + a.height, b.y + b.height);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  return (ix2 - ix1) * (iy2 - iy1);
}

export function rectIou(a: RectPt, b: RectPt): number {
  const inter = rectIntersectionArea(a, b);
  if (inter <= 0) return 0;
  const union = rectArea(a) + rectArea(b) - inter;
  return union > 0 ? inter / union : 0;
}
