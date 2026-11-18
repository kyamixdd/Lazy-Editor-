import { ScanCorrectionRule } from '../types/pdfStudio';
import {
  ProcessedPageResult,
  processRawPageScan,
} from '../utils/documentRelationshipEngine';
import { RawPageScanInput } from '../utils/scanPrimitives';

export interface ScanStructureWorkerRequest {
  id: string;
  input: RawPageScanInput;
  correctionRules?: ScanCorrectionRule[];
}

export interface ScanStructureWorkerResponse {
  id: string;
  result?: ProcessedPageResult;
  error?: string;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.addEventListener('message', (event: MessageEvent<ScanStructureWorkerRequest>) => {
    const { id, input, correctionRules } = event.data;
    try {
      const result = processRawPageScan(input, correctionRules || []);
      (
        self as unknown as {
          postMessage: (msg: ScanStructureWorkerResponse) => void;
        }
      ).postMessage({ id, result });
    } catch (err) {
      (
        self as unknown as {
          postMessage: (msg: ScanStructureWorkerResponse) => void;
        }
      ).postMessage({
        id,
        error: err instanceof Error ? err.message : 'Worker structural analysis failed',
      });
    }
  });
}

let sharedWorker: Worker | null = null;

function getOrCreateWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(
        new URL('./scanStructureWorker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch {
      return null;
    }
  }
  return sharedWorker;
}

/**
 * Offloads multi-pass geometric classification, table grid reconstruction, and
 * hierarchy building to a background Web Worker (with transparent main-thread fallback).
 */
export async function runPageStructureAnalysis(
  input: RawPageScanInput,
  correctionRules: ScanCorrectionRule[] = [],
  signal?: AbortSignal
): Promise<ProcessedPageResult> {
  if (signal?.aborted) {
    throw new Error('Scan cancelled');
  }
  const worker = getOrCreateWorker();
  if (!worker) {
    return processRawPageScan(input, correctionRules);
  }

  return new Promise<ProcessedPageResult>((resolve, reject) => {
    const id = `scan-w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const cleanup = () => {
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('Scan cancelled'));
    };

    const onMsg = (ev: MessageEvent<ScanStructureWorkerResponse>) => {
      if (ev.data?.id !== id) return;
      cleanup();
      if (ev.data.error || !ev.data.result) {
        // Fallback safely on worker serialization edge cases
        try {
          resolve(processRawPageScan(input, correctionRules));
        } catch (err) {
          reject(err);
        }
      } else {
        resolve(ev.data.result);
      }
    };

    const onErr = () => {
      cleanup();
      try {
        resolve(processRawPageScan(input, correctionRules));
      } catch (err) {
        reject(err);
      }
    };

    signal?.addEventListener('abort', onAbort);
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
    worker.postMessage({ id, input, correctionRules });
  });
}
