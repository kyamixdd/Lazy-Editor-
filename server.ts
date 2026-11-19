import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PROJECT_API_ENABLED = process.env.ENABLE_PROJECT_API === 'true';

app.use(express.json({ limit: '60mb' }));

// Local JSON storage directory for projects & templates
const DATA_DIR = path.resolve(process.cwd(), '.studio_data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

function readStoredProjects(): Record<string, unknown>[] {
  ensureDataStore();
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredProjects(projects: Record<string, unknown>[]) {
  ensureDataStore();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
}

function getGeminiClient(req?: express.Request): GoogleGenAI {
  // A user-provided key is accepted per request and never persisted by this server.
  // The server environment key remains available as an optional operator fallback.
  const headerKey = req?.get('x-gemini-api-key');
  const apiKey = (typeof headerKey === 'string' ? headerKey.trim() : '') || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error(
      'No Gemini API key is configured. Add your own key in Settings > AI & Gemini.'
    ) as Error & { code?: string };
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function classifyGeminiHttpError(err: unknown): {
  status: number;
  code: string;
  error: string;
} {
  const errObj = err as { code?: string; status?: number; message?: string };
  const message =
    err instanceof Error ? err.message : String(err || 'Gemini AI request failed');
  const lower = message.toLowerCase();

  if (errObj?.code === 'MISSING_API_KEY' || lower.includes('not configured')) {
    return {
      status: 503,
      code: 'MISSING_API_KEY',
      error:
        'No Gemini API key was supplied. Add your Gemini key in Settings > AI & Gemini. Local scanning and PDF editing remain available.',
    };
  }
  if (
    errObj?.status === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota')
  ) {
    return {
      status: 429,
      code: 'QUOTA_EXHAUSTED',
      error:
        'Gemini API quota exhausted or rate-limited. Continue using Local PDF Scan and full editor/export features without AI credits.',
    };
  }
  if (
    errObj?.status === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid')
  ) {
    return {
      status: 403,
      code: 'API_KEY_INVALID',
      error:
        'Gemini API key was rejected or lacks permission. Verify your Gemini API key in Settings > AI & Gemini.',
    };
  }
  if (errObj?.status === 400 || lower.includes('invalid_argument')) {
    return {
      status: 400,
      code: 'AI_REQUEST_INVALID',
      error:
        'Gemini rejected the request. Check the selected model, request format, and supported input limits; this does not necessarily indicate an invalid API key.',
    };
  }
  return {
    status: 500,
    code: 'AI_UNAVAILABLE',
    error: message,
  };
}

// Health endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'lazy-editor' });
});

// Project persistence is disabled by default because these endpoints do not yet
// implement user authentication or per-user ownership isolation. Enable only in a
// trusted, single-user environment behind an authenticated reverse proxy.
app.use('/api/projects', (_req, res, next) => {
  if (!PROJECT_API_ENABLED) {
    res.status(503).json({
      error: 'Server project persistence is disabled until authenticated access is configured. Local browser storage remains available.',
      code: 'PROJECT_API_DISABLED',
    });
    return;
  }
  next();
});

// Project & template persistence endpoints
app.get('/api/projects', (_req, res) => {
  res.json({ projects: readStoredProjects() });
});

app.post('/api/projects', (req, res) => {
  const project = req.body;
  if (!project || typeof project.id !== 'string') {
    res.status(400).json({ error: 'Invalid project payload' });
    return;
  }
  const existing = readStoredProjects();
  const idx = existing.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    existing[idx] = project;
  } else {
    existing.unshift(project);
  }
  writeStoredProjects(existing);
  res.json({ ok: true, id: project.id });
});

app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const existing = readStoredProjects();
  const filtered = existing.filter((p) => p.id !== id);
  writeStoredProjects(filtered);
  res.json({ ok: true });
});

// Real PDF generator for "Create Blank / Starter Template PDF"
app.post('/api/pdf/create-starter', async (req, res) => {
  try {
    const { templateKind = 'invoice', widthPt = 595.28, heightPt = 841.89 } =
      req.body || {};
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([widthPt, heightPt]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    if (templateKind === 'dual_receipt') {
      // Create a genuine 2-block receipt sheet PDF for testing multi-block extraction & serial numbering
      const drawReceiptBlock = (
        yTop: number,
        title: string,
        receiptNo: string
      ) => {
        const boxH = heightPt / 2 - 48;
        const boxY = heightPt - yTop - boxH;
        page.drawRectangle({
          x: 36,
          y: boxY,
          width: widthPt - 72,
          height: boxH,
          borderColor: rgb(0.2, 0.25, 0.35),
          borderWidth: 1.2,
          color: rgb(0.99, 0.99, 1),
        });
        page.drawText(title, {
          x: 54,
          y: boxY + boxH - 36,
          size: 16,
          font: helveticaBold,
          color: rgb(0.08, 0.12, 0.2),
        });
        page.drawText(`Receipt No: ${receiptNo}`, {
          x: widthPt - 210,
          y: boxY + boxH - 36,
          size: 12,
          font: helveticaBold,
          color: rgb(0.15, 0.35, 0.72),
        });
        page.drawText('Customer Name: ___________________________', {
          x: 54,
          y: boxY + boxH - 74,
          size: 11,
          font: helvetica,
          color: rgb(0.2, 0.2, 0.25),
        });
        page.drawText('Date: 2026-11-18', {
          x: widthPt - 210,
          y: boxY + boxH - 74,
          size: 11,
          font: helvetica,
          color: rgb(0.2, 0.2, 0.25),
        });
        page.drawLine({
          start: { x: 54, y: boxY + boxH - 96 },
          end: { x: widthPt - 54, y: boxY + boxH - 96 },
          thickness: 0.8,
          color: rgb(0.8, 0.84, 0.9),
        });
        page.drawText('Description', {
          x: 54,
          y: boxY + boxH - 118,
          size: 10,
          font: helveticaBold,
          color: rgb(0.3, 0.35, 0.45),
        });
        page.drawText('Amount', {
          x: widthPt - 130,
          y: boxY + boxH - 118,
          size: 10,
          font: helveticaBold,
          color: rgb(0.3, 0.35, 0.45),
        });
        page.drawText('Standard Service Package', {
          x: 54,
          y: boxY + boxH - 144,
          size: 10.5,
          font: helvetica,
          color: rgb(0.15, 0.15, 0.2),
        });
        page.drawText('$250.00', {
          x: widthPt - 130,
          y: boxY + boxH - 144,
          size: 10.5,
          font: helvetica,
          color: rgb(0.15, 0.15, 0.2),
        });
        page.drawText('Total Paid: $250.00', {
          x: widthPt - 180,
          y: boxY + 34,
          size: 12,
          font: helveticaBold,
          color: rgb(0.08, 0.12, 0.2),
        });
      };
      drawReceiptBlock(28, 'OFFICIAL PAYMENT RECEIPT', 'RCP-0001');
      drawReceiptBlock(heightPt / 2 + 12, 'OFFICIAL PAYMENT RECEIPT', 'RCP-0002');
    } else if (templateKind === 'invoice') {
      page.drawRectangle({
        x: 36,
        y: heightPt - 120,
        width: widthPt - 72,
        height: 84,
        color: rgb(0.95, 0.96, 0.98),
        borderColor: rgb(0.82, 0.85, 0.9),
        borderWidth: 1,
      });
      page.drawText('NORTHSTAR LOGISTICS INC.', {
        x: 54,
        y: heightPt - 68,
        size: 18,
        font: helveticaBold,
        color: rgb(0.07, 0.1, 0.18),
      });
      page.drawText('INVOICE', {
        x: widthPt - 160,
        y: heightPt - 68,
        size: 18,
        font: helveticaBold,
        color: rgb(0.15, 0.38, 0.78),
      });
      page.drawText('Invoice #: INV-0001', {
        x: widthPt - 180,
        y: heightPt - 94,
        size: 11,
        font: helveticaBold,
        color: rgb(0.2, 0.25, 0.32),
      });
      page.drawText('Bill To: Meridian Retail Group', {
        x: 54,
        y: heightPt - 160,
        size: 11.5,
        font: helveticaBold,
        color: rgb(0.15, 0.18, 0.24),
      });
      page.drawText('Issue Date: 2026-11-18', {
        x: 54,
        y: heightPt - 180,
        size: 10.5,
        font: helvetica,
        color: rgb(0.3, 0.34, 0.42),
      });
      page.drawRectangle({
        x: 36,
        y: heightPt - 340,
        width: widthPt - 72,
        height: 120,
        borderColor: rgb(0.75, 0.78, 0.84),
        borderWidth: 0.8,
      });
      page.drawText('Item Description', {
        x: 50,
        y: heightPt - 245,
        size: 10,
        font: helveticaBold,
        color: rgb(0.2, 0.24, 0.3),
      });
      page.drawText('Qty', {
        x: 330,
        y: heightPt - 245,
        size: 10,
        font: helveticaBold,
        color: rgb(0.2, 0.24, 0.3),
      });
      page.drawText('Total', {
        x: 470,
        y: heightPt - 245,
        size: 10,
        font: helveticaBold,
        color: rgb(0.2, 0.24, 0.3),
      });
      page.drawText('Freight & Fulfillment Services', {
        x: 50,
        y: heightPt - 275,
        size: 10.5,
        font: helvetica,
        color: rgb(0.15, 0.15, 0.2),
      });
      page.drawText('1', {
        x: 335,
        y: heightPt - 275,
        size: 10.5,
        font: helvetica,
        color: rgb(0.15, 0.15, 0.2),
      });
      page.drawText('$1,240.00', {
        x: 465,
        y: heightPt - 275,
        size: 10.5,
        font: helvetica,
        color: rgb(0.15, 0.15, 0.2),
      });
      page.drawText('Amount Due: $1,240.00', {
        x: widthPt - 210,
        y: heightPt - 380,
        size: 13,
        font: helveticaBold,
        color: rgb(0.07, 0.1, 0.18),
      });
    } else {
      // Blank clean PDF canvas
      page.drawText('Untitled Document', {
        x: 48,
        y: heightPt - 64,
        size: 18,
        font: helveticaBold,
        color: rgb(0.1, 0.12, 0.18),
      });
    }

    const bytes = await pdfDoc.save();
    const base64 = Buffer.from(bytes).toString('base64');
    res.json({ base64 });
  } catch (err) {
    console.error('Starter PDF creation error:', err);
    res.status(500).json({ error: 'Failed to create starter PDF' });
  }
});

// Validate a user-supplied Gemini key without storing or logging it.
app.post('/api/ai/validate-key', async (req, res) => {
  try {
    const key = req.get('x-gemini-api-key')?.trim();
    if (!key || key.length < 20 || key.length > 512) {
      res.status(400).json({ ok: false, error: 'Enter a valid Gemini API key.' });
      return;
    }
    const ai = getGeminiClient(req);
    await ai.models.generateContent({
      model: resolveGeminiModel(process.env.GEMINI_MODEL),
      contents: 'Reply with the single word OK.',
      config: { maxOutputTokens: 8 },
    });
    res.json({ ok: true, message: 'Gemini API key verified successfully.' });
  } catch (err) {
    const classified = classifyGeminiHttpError(err);
    res.status(classified.status).json({ ok: false, error: classified.error, code: classified.code });
  }
});

// Gemini Multimodal PDF Analysis Endpoint
app.post('/api/ai/analyze-pdf', async (req, res) => {
  try {
    const { pages, fileName } = req.body as {
      fileName: string;
      pages: Array<{
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
      }>;
    };

    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      res.status(400).json({ error: 'No pages provided for analysis' });
      return;
    }

    const ai = getGeminiClient(req);
    const allElements: Record<string, unknown>[] = [];
    const pageSummaries: string[] = [];

    // Analyze pages in batches (page-by-page ensures high precision & avoids token truncation on large PDFs)
    for (const page of pages) {
      const compactTextItems = page.extractedTextItems || [];
      // Preserve every extracted text item; arbitrary per-page truncation caused
      // dense forms and receipts to lose fields before AI analysis.
      const mimeMatch = page.imageBase64.match(/^data:(image\/\w+);base64,/);
      const imageMimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const imageBase64Clean = page.imageBase64.replace(
        /^data:image\/\w+;base64,/,
        ''
      );

      const promptText = `You are a precision document layout analyzer for Lazy Editor.
Analyze Page ${page.pageNumber} of "${fileName}" (page size: ${page.widthPt.toFixed(2)}pt x ${page.heightPt.toFixed(2)}pt, top-left origin).

Extracted text coordinates from PDF.js / OCR (in PDF points, top-left origin):
${JSON.stringify(compactTextItems)}

Instructions:
1. Identify and extract ALL distinct visual and semantic elements on this page:
   - headings/titles ('heading')
   - body/label text ('text')
   - invoice numbers ('invoice_number')
   - receipt numbers ('receipt_number')
   - tables ('table')
   - logos/images ('image')
   - borders/containers ('border')
   - shapes/lines ('shape' or 'line')
   - form fields ('form_field')
   - repeated receipt or document blocks ('repeated_block')
2. Use the exact PDF.js/OCR coordinates (x, y, width, height, fontSize) whenever a text item matches! If the page is scanned/image-based or has visual shapes/logos without text coordinates, estimate bounding boxes carefully in PDF points (0..${page.widthPt.toFixed(1)} x 0..${page.heightPt.toFixed(1)}).
3. Group repeated receipt/document blocks by assigning a consistent 'blockId' (e.g. "block-A", "block-B") to elements belonging to each repeated block.
4. Detect relationships between fields (e.g. "Label for invoice_number", "Belongs to block-A") in 'relationshipNote'.
5. NEVER invent missing text or numbers. If any element is blurry, partially occluded, or uncertain, set 'confidence' below 0.75, 'needsReview' to true, and explain why in 'reviewReason'.
6. Suggest a clean 'fieldKey' for dynamic/data-mappable fields (like "invoice_number", "receipt_number", "customer_name", "date", "total_amount").`;

      const response = await ai.models.generateContent({
        model: resolveGeminiModel(process.env.GEMINI_MODEL),
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: imageMimeType,
                data: imageBase64Clean,
              },
            },
            { text: promptText },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              orientation: { type: Type.STRING },
              elements: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    text: { type: Type.STRING },
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    width: { type: Type.NUMBER },
                    height: { type: Type.NUMBER },
                    fontFamily: { type: Type.STRING },
                    fontSize: { type: Type.NUMBER },
                    fontWeight: { type: Type.STRING },
                    fontStyle: { type: Type.STRING },
                    color: { type: Type.STRING },
                    backgroundColor: { type: Type.STRING },
                    align: { type: Type.STRING },
                    editable: { type: Type.BOOLEAN },
                    confidence: { type: Type.NUMBER },
                    needsReview: { type: Type.BOOLEAN },
                    reviewReason: { type: Type.STRING },
                    blockId: { type: Type.STRING },
                    fieldKey: { type: Type.STRING },
                    relationshipNote: { type: Type.STRING },
                  },
                  required: [
                    'type',
                    'text',
                    'x',
                    'y',
                    'width',
                    'height',
                    'confidence',
                    'needsReview',
                  ],
                },
              },
            },
            required: ['summary', 'elements'],
          },
        },
      });

      const rawJson = (response.text || '{}').trim();
      const parsed = JSON.parse(rawJson) as {
        summary?: string;
        elements?: Array<Record<string, unknown>>;
      };

      if (parsed.summary) {
        pageSummaries.push(`Page ${page.pageNumber}: ${parsed.summary}`);
      }

      const validTypes = new Set([
        'heading',
        'text',
        'invoice_number',
        'receipt_number',
        'table',
        'image',
        'shape',
        'line',
        'border',
        'form_field',
        'repeated_block',
      ]);

      (parsed.elements || []).forEach((el, idx) => {
        const elType = validTypes.has(String(el.type))
          ? String(el.type)
          : 'text';
        const confidence =
          typeof el.confidence === 'number'
            ? Math.max(0, Math.min(1, el.confidence))
            : 0.85;
        const needsReview =
          Boolean(el.needsReview) || confidence < 0.75;
        const x = Math.max(0, Number(el.x) || 0);
        const y = Math.max(0, Number(el.y) || 0);
        const width = Math.max(8, Number(el.width) || 80);
        const height = Math.max(8, Number(el.height) || 18);

        allElements.push({
          id: `el-p${page.pageNumber}-${idx + 1}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          type: elType,
          pageNumber: page.pageNumber,
          x,
          y,
          width,
          height,
          rotation: 0,
          text: String(el.text ?? ''),
          fontFamily: String(el.fontFamily || 'Helvetica'),
          fontSize: Math.max(6, Math.min(96, Number(el.fontSize) || 11)),
          fontWeight: el.fontWeight === 'bold' ? 'bold' : 'normal',
          fontStyle: el.fontStyle === 'italic' ? 'italic' : 'normal',
          color: /^#[0-9a-fA-F]{6}$/.test(String(el.color || ''))
            ? String(el.color)
            : '#111827',
          backgroundColor: /^#[0-9a-fA-F]{6}$/.test(
            String(el.backgroundColor || '')
          )
            ? String(el.backgroundColor)
            : 'transparent',
          align:
            el.align === 'center' || el.align === 'right' ? el.align : 'left',
          opacity: 1,
          editable: el.editable !== false,
          locked: false,
          visible: true,
          confidence,
          needsReview,
          reviewReason: el.reviewReason ? String(el.reviewReason) : undefined,
          blockId: el.blockId ? String(el.blockId) : undefined,
          fieldKey: el.fieldKey ? String(el.fieldKey) : undefined,
          relationshipNote: el.relationshipNote
            ? String(el.relationshipNote)
            : undefined,
          eraseOriginal: false,
          sourceOriginalRect: { x, y, width, height },
        });
      });
    }

    res.json({
      summary: pageSummaries.join(' | '),
      elements: allElements,
    });
  } catch (err) {
    const classified = classifyGeminiHttpError(err);
    console.warn('AI analyze-pdf request failed:', classified.code);
    res.status(classified.status).json({ error: classified.error, code: classified.code });
  }
});

// Gemini AI Editing Assistant Endpoint
app.post('/api/ai/edit-command', async (req, res) => {
  try {
    const {
      instruction,
      currentElements,
      selectedElementIds,
      pageConfig,
      currentPage,
    } = req.body;

    if (!instruction || typeof instruction !== 'string') {
      res.status(400).json({ error: 'Instruction text is required' });
      return;
    }

    const ai = getGeminiClient(req);

    const compactElements = (currentElements || []).map(
      (el: Record<string, unknown>) => ({
        id: el.id,
        type: el.type,
        pageNumber: el.pageNumber,
        text: el.text,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        fontFamily: el.fontFamily,
        color: el.color,
        align: el.align,
        blockId: el.blockId,
        fieldKey: el.fieldKey,
        locked: el.locked,
      })
    );

    const prompt = `You are the AI Document Editing Assistant inside Lazy Editor.
User instruction: "${instruction}"
Current active page: ${currentPage}
Page dimensions: ${pageConfig?.widthPt}pt x ${pageConfig?.heightPt}pt
Currently selected element IDs: ${JSON.stringify(selectedElementIds || [])}

Document elements JSON:
${JSON.stringify(compactElements)}

Generate exact structured mutations to fulfill the user's instruction on the actual document elements.
Rules:
- Respect locked elements (do not modify elements where locked === true unless asked to unlock).
- When modifying text or positioning of an existing detected element, return action: "update" with targetId and patch.
- When duplicating a block or element, return action: "duplicate" with targetId and patch (e.g. offset x/y).
- When adding a new element, return action: "create" with newElement fields.
- When removing elements, return action: "delete" with targetId.
- Set requiresConfirmation = true whenever 2 or more elements are altered, elements are deleted/duplicated, or significant layout/text changes occur.
- Never invent non-existent targetIds.`;

    const response = await ai.models.generateContent({
      model: resolveGeminiModel(process.env.GEMINI_MODEL),
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            requiresConfirmation: { type: Type.BOOLEAN },
            impactDescription: { type: Type.STRING },
            operations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  action: { type: Type.STRING },
                  targetId: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  patch: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER },
                      width: { type: Type.NUMBER },
                      height: { type: Type.NUMBER },
                      fontSize: { type: Type.NUMBER },
                      fontWeight: { type: Type.STRING },
                      fontStyle: { type: Type.STRING },
                      fontFamily: { type: Type.STRING },
                      color: { type: Type.STRING },
                      backgroundColor: { type: Type.STRING },
                      align: { type: Type.STRING },
                      rotation: { type: Type.NUMBER },
                      blockId: { type: Type.STRING },
                      fieldKey: { type: Type.STRING },
                    },
                  },
                  newElement: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      pageNumber: { type: Type.NUMBER },
                      text: { type: Type.STRING },
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER },
                      width: { type: Type.NUMBER },
                      height: { type: Type.NUMBER },
                      fontSize: { type: Type.NUMBER },
                      fontWeight: { type: Type.STRING },
                      color: { type: Type.STRING },
                      align: { type: Type.STRING },
                    },
                  },
                },
                required: ['action', 'reason'],
              },
            },
          },
          required: [
            'summary',
            'requiresConfirmation',
            'impactDescription',
            'operations',
          ],
        },
      },
    });

    const plan = JSON.parse((response.text || '{}').trim());
    res.json(plan);
  } catch (err) {
    const classified = classifyGeminiHttpError(err);
    console.warn('AI edit-command request failed:', classified.code);
    res.status(classified.status).json({ error: classified.error, code: classified.code });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Lazy Editor server running on http://localhost:${PORT}`);
  });
}

startServer();
