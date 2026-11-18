import { DocumentElement, PDFProject } from '../types/pdfStudio';
import { base64ToUint8Array, renderPdfPagesForStudio } from './pdfRenderer';
import { appendOperationLog } from './projectStorage';

export interface AiAnalysisResponseResult {
  ok: boolean;
  code?: 'QUOTA_EXHAUSTED' | 'MISSING_API_KEY' | 'API_KEY_INVALID' | 'AI_REQUEST_INVALID' | 'AI_UNAVAILABLE';
  message: string;
  updatedProject?: PDFProject;
  addedOrUpdatedCount?: number;
}

export function formatFriendlyAiError(
  rawMessage: string,
  status?: number,
  code?: string
): {
  code: 'QUOTA_EXHAUSTED' | 'MISSING_API_KEY' | 'API_KEY_INVALID' | 'AI_REQUEST_INVALID' | 'AI_UNAVAILABLE';
  message: string;
} {
  const lower = (rawMessage || '').toLowerCase();
  if (
    code === 'QUOTA_EXHAUSTED' ||
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return {
      code: 'QUOTA_EXHAUSTED',
      message:
        'Gemini API quota is exhausted or rate-limited. You can continue using Local PDF Scan, visual editing, bulk generation, and PDF export without restrictions.',
    };
  }
  if (
    code === 'MISSING_API_KEY' ||
    lower.includes('not configured') ||
    lower.includes('missing')
  ) {
    return {
      code: 'MISSING_API_KEY',
      message:
        'Gemini API key is not configured in Settings > Secrets. Local PDF Scan and all editing, bulk generation, and export features remain fully active.',
    };
  }
  if (code === 'AI_REQUEST_INVALID' || status === 400) {
    return {
      code: 'AI_REQUEST_INVALID',
      message: rawMessage || 'The AI provider rejected this request. Check the selected model and request format; your API key may still be valid.',
    };
  }
  if (
    code === 'API_KEY_INVALID' ||
    status === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid')
  ) {
    return {
      code: 'API_KEY_INVALID',
      message:
        'Gemini API key lacks permission or is invalid. Verify Settings > Secrets or continue editing using Local PDF Scan.',
    };
  }
  return {
    code: 'AI_UNAVAILABLE',
    message:
      rawMessage ||
      'AI-Enhanced Analysis is temporarily unavailable. Continue working seamlessly with Local PDF Scan.',
  };
}

function rectDistance(a: DocumentElement, b: DocumentElement): number {
  const cx1 = a.x + a.width / 2;
  const cy1 = a.y + a.height / 2;
  const cx2 = b.x + b.width / 2;
  const cy2 = b.y + b.height / 2;
  return Math.hypot(cx1 - cx2, cy1 - cy2);
}

export async function runOptionalAiEnhancedAnalysis(
  project: PDFProject
): Promise<AiAnalysisResponseResult> {
  try {
    let pagesPayload: Array<{
      pageNumber: number;
      widthPt: number;
      heightPt: number;
      imageBase64: string;
      extractedTextItems: Array<{
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fontSize: number;
        fontName: string;
      }>;
    }> = [];

    if (project.sourcePdfBase64) {
      const pdfBytes = base64ToUint8Array(project.sourcePdfBase64);
      const rendered = await renderPdfPagesForStudio(pdfBytes, {
        renderScale: 1.5,
        enableOcrFallback: false,
        maxPagesForAi: Math.max(1, project.pageCount),
      });
      pagesPayload = rendered.pages.map((p) => ({
        pageNumber: p.pageNumber,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
        imageBase64: p.imageBase64,
        extractedTextItems: p.extractedTextItems.map((t) => ({
          text: t.text,
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          fontSize: t.fontSize,
          fontName: t.fontName,
        })),
      }));
    } else {
      pagesPayload = project.originalPages
        .filter((p) => Boolean(p.previewImageDataUrl))
        .map((p) => ({
          pageNumber: p.pageNumber,
          widthPt: p.widthPt,
          heightPt: p.heightPt,
          imageBase64: p.previewImageDataUrl!,
          extractedTextItems: project.elements
            .filter((e) => e.pageNumber === p.pageNumber && e.text.trim())
            .map((e) => ({
              text: e.text,
              x: e.x,
              y: e.y,
              width: e.width,
              height: e.height,
              fontSize: e.fontSize,
              fontName: e.fontFamily,
            })),
        }));
    }

    if (pagesPayload.length === 0) {
      return {
        ok: false,
        code: 'AI_UNAVAILABLE',
        message: 'No rendered pages available to analyze.',
      };
    }

    const response = await fetch('/api/ai/analyze-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: project.sourcePdfName || project.name,
        pages: pagesPayload,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const friendly = formatFriendlyAiError(
        data.error || `HTTP ${response.status}`,
        response.status,
        data.code
      );
      return {
        ok: false,
        code: friendly.code,
        message: friendly.message,
      };
    }

    const aiElements = (data.elements || []) as DocumentElement[];
    const aiSummary = String(data.summary || '');

    // Preserve user-added, locked, and manually modified elements; enrich matching local elements semantically
    const mergedElements: DocumentElement[] = project.elements.map((localEl) => {
      if (localEl.locked || localEl.isUserAdded || localEl.eraseOriginal) {
        return localEl;
      }

      const match = aiElements.find(
        (aiEl) =>
          aiEl.pageNumber === localEl.pageNumber &&
          ((aiEl.text.trim() &&
            localEl.text.trim() &&
            aiEl.text.trim().toLowerCase() === localEl.text.trim().toLowerCase() &&
            rectDistance(aiEl, localEl) <= 45) ||
            rectDistance(aiEl, localEl) <= 14)
      );

      if (!match) return localEl;

      return {
        ...localEl,
        type: match.type || localEl.type,
        fieldKey: match.fieldKey || localEl.fieldKey,
        blockId: match.blockId || localEl.blockId,
        relationshipNote: match.relationshipNote || localEl.relationshipNote,
        needsReview: match.needsReview ?? localEl.needsReview,
        reviewReason: match.reviewReason || localEl.reviewReason,
      };
    });

    // Append any genuine AI-detected elements that had no nearby local equivalent
    let addedCount = 0;
    for (const aiEl of aiElements) {
      const hasLocalNear = mergedElements.some(
        (loc) =>
          loc.pageNumber === aiEl.pageNumber &&
          (rectDistance(loc, aiEl) <= 22 ||
            (aiEl.text.trim() &&
              loc.text.trim().toLowerCase() === aiEl.text.trim().toLowerCase()))
      );
      if (!hasLocalNear) {
        mergedElements.push({
          ...aiEl,
          isUserAdded: false,
          eraseOriginal: false,
        });
        addedCount++;
      }
    }

    const updated = appendOperationLog(
      {
        ...project,
        elements: mergedElements,
        aiSummary: aiSummary
          ? `${aiSummary} (AI-Enhanced over Local Scan)`
          : project.aiSummary,
        updatedAt: new Date().toISOString(),
      },
      'AI-Enhanced Analysis',
      `Enriched semantic classifications & relationships (${addedCount} new detections)`
    );

    return {
      ok: true,
      message: `AI-Enhanced Analysis complete (${aiElements.length} detections merged safely over Local PDF Scan).`,
      updatedProject: updated,
      addedOrUpdatedCount: aiElements.length,
    };
  } catch (err) {
    const friendly = formatFriendlyAiError(
      err instanceof Error ? err.message : 'Network error during AI-Enhanced Analysis'
    );
    return {
      ok: false,
      code: friendly.code,
      message: friendly.message,
    };
  }
}
