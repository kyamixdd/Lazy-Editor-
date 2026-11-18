import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRawStream,
  PDFSignature,
  PDFTextField,
} from 'pdf-lib';
import { PageBoxesMeta, RectPt } from '../types/pdfStudio';

export interface InspectedAnnotation {
  pageNumber: number;
  subtype: string;
  rect: RectPt;
  contents?: string;
  fieldName?: string;
  isWidget: boolean;
}

export interface InspectedFormWidget {
  id: string;
  pageNumber: number;
  name: string;
  kind: 'text_input' | 'checkbox' | 'radio_button' | 'dropdown' | 'signature_field';
  rect: RectPt;
  value: string;
  checked?: boolean;
  options?: string[];
}

export interface InspectedPageDetail {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
  boxes: PageBoxesMeta;
  embeddedFonts: string[];
  imageResourceNames: string[];
  hasTransparency: boolean;
  streamCount: number;
  annotations: InspectedAnnotation[];
  formWidgets: InspectedFormWidget[];
}

export interface PdfDocumentInspection {
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
  };
  pages: InspectedPageDetail[];
  totalEmbeddedFonts: number;
  totalImageResources: number;
  totalAnnotations: number;
  totalFormWidgets: number;
}

function pdfBoxToTopLeftRect(
  box: { x: number; y: number; width: number; height: number } | undefined,
  pageHeightPt: number,
  cropOriginX = 0,
  cropOriginY = 0
): RectPt | undefined {
  if (!box) return undefined;
  return {
    x: Number((box.x - cropOriginX).toFixed(2)),
    y: Number((pageHeightPt - (box.y - cropOriginY + box.height)).toFixed(2)),
    width: Number(box.width.toFixed(2)),
    height: Number(box.height.toFixed(2)),
  };
}

function pdfArrayRectToTopLeft(
  arr: PDFArray | undefined,
  pageHeightPt: number,
  cropOriginX = 0,
  cropOriginY = 0
): RectPt | null {
  if (!arr || arr.size() < 4) return null;
  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    const val = arr.lookup(i);
    if (val instanceof PDFNumber) {
      nums.push(val.asNumber());
    } else {
      return null;
    }
  }
  const x1 = Math.min(nums[0], nums[2]) - cropOriginX;
  const x2 = Math.max(nums[0], nums[2]) - cropOriginX;
  const y1 = Math.min(nums[1], nums[3]) - cropOriginY;
  const y2 = Math.max(nums[1], nums[3]) - cropOriginY;
  const w = Math.max(2, x2 - x1);
  const h = Math.max(2, y2 - y1);
  return {
    x: Number(x1.toFixed(2)),
    y: Number((pageHeightPt - y2).toFixed(2)),
    width: Number(w.toFixed(2)),
    height: Number(h.toFixed(2)),
  };
}

/**
 * PASS 1 — PDF Document Inspection (100% Local via pdf-lib)
 * Extracts page boxes (MediaBox, CropBox, BleedBox, TrimBox, ArtBox), rotation,
 * content streams count, embedded font resources, image XObjects, ExtGState
 * transparency flags, annotations, AcroForm widgets, and document metadata.
 */
export async function inspectPdfStructure(
  pdfBytes: Uint8Array
): Promise<PdfDocumentInspection> {
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const metadata = {
    title: pdfDoc.getTitle() || undefined,
    author: pdfDoc.getAuthor() || undefined,
    subject: pdfDoc.getSubject() || undefined,
    creator: pdfDoc.getCreator() || undefined,
    producer: pdfDoc.getProducer() || undefined,
  };

  const pageCount = pdfDoc.getPageCount();
  const pdfPages = pdfDoc.getPages();
  const pageRefToNumber = new Map<string, number>();
  pdfPages.forEach((pg, idx) => {
    pageRefToNumber.set(pg.ref.toString(), idx + 1);
  });

  // Collect AcroForm field metadata mapped by widget ref & page
  const widgetMetaByRef = new Map<
    string,
    {
      name: string;
      kind: InspectedFormWidget['kind'];
      value: string;
      checked?: boolean;
      options?: string[];
    }
  >();

  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    for (const field of fields) {
      const name = field.getName();
      let kind: InspectedFormWidget['kind'] = 'text_input';
      let value = '';
      let checked: boolean | undefined;
      let options: string[] | undefined;

      if (field instanceof PDFTextField) {
        kind = 'text_input';
        value = field.getText() || '';
      } else if (field instanceof PDFCheckBox) {
        kind = 'checkbox';
        checked = field.isChecked();
        value = checked ? 'Yes' : 'Off';
      } else if (field instanceof PDFRadioGroup) {
        kind = 'radio_button';
        value = field.getSelected() || '';
        options = field.getOptions();
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        kind = 'dropdown';
        const sel = field.getSelected();
        value = Array.isArray(sel) ? sel.join(', ') : '';
        options = field.getOptions();
      } else if (field instanceof PDFSignature) {
        kind = 'signature_field';
        value = '[Signature]';
      }

      const widgets = field.acroField.getWidgets();
      for (const w of widgets) {
        const dictKey = w.dict.toString();
        widgetMetaByRef.set(dictKey, { name, kind, value, checked, options });
      }
    }
  } catch {
    // Document has no AcroForm or uses malformed widget dictionaries
  }

  const allFonts = new Set<string>();
  const allImages = new Set<string>();
  let totalAnnotations = 0;
  let totalFormWidgets = 0;

  const pages: InspectedPageDetail[] = pdfPages.map((pg, idx) => {
    const pageNumber = idx + 1;
    const rawAngle = ((pg.getRotation().angle % 360) + 360) % 360;
    const rotation = (
      rawAngle === 90 || rawAngle === 180 || rawAngle === 270 ? rawAngle : 0
    ) as 0 | 90 | 180 | 270;

    const media = pg.getMediaBox();
    const crop = pg.getCropBox();
    const activeBox = crop || media;
    const widthPt = Number(activeBox.width.toFixed(2));
    const heightPt = Number(activeBox.height.toFixed(2));

    const boxes: PageBoxesMeta = {
      mediaBox: pdfBoxToTopLeftRect(media, activeBox.height, activeBox.x, activeBox.y)!,
      cropBox: pdfBoxToTopLeftRect(crop, activeBox.height, activeBox.x, activeBox.y),
      bleedBox: pdfBoxToTopLeftRect(pg.getBleedBox(), activeBox.height, activeBox.x, activeBox.y),
      trimBox: pdfBoxToTopLeftRect(pg.getTrimBox(), activeBox.height, activeBox.x, activeBox.y),
      artBox: pdfBoxToTopLeftRect(pg.getArtBox(), activeBox.height, activeBox.x, activeBox.y),
    };

    // Inspect content stream count
    let streamCount = 0;
    const contents = pg.node.get(PDFName.of('Contents'));
    if (contents instanceof PDFArray) {
      streamCount = contents.size();
    } else if (contents) {
      streamCount = 1;
    }

    // Inspect page Resources (Fonts, XObjects, ExtGState transparency)
    const embeddedFonts: string[] = [];
    const imageResourceNames: string[] = [];
    let hasTransparency = false;

    const resources = pg.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
    if (resources) {
      const fontDict = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
      if (fontDict) {
        for (const [k] of fontDict.entries()) {
          const fRef = fontDict.lookupMaybe(k, PDFDict);
          const baseFont = fRef?.get(PDFName.of('BaseFont'))?.toString().replace(/^\//, '');
          const fontName = baseFont || k.toString().replace(/^\//, '');
          embeddedFonts.push(fontName);
          allFonts.add(fontName);
        }
      }

      const xObjDict = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (xObjDict) {
        for (const [k] of xObjDict.entries()) {
          const rawXObj = xObjDict.lookup(k);
          const xDict =
            rawXObj instanceof PDFRawStream
              ? rawXObj.dict
              : rawXObj instanceof PDFDict
              ? rawXObj
              : undefined;
          const sub = xDict?.get(PDFName.of('Subtype'))?.toString();
          if (sub === '/Image') {
            const imgName = k.toString().replace(/^\//, '');
            imageResourceNames.push(imgName);
            allImages.add(`${pageNumber}:${imgName}`);
            if (xDict?.get(PDFName.of('SMask')) || xDict?.get(PDFName.of('ImageMask'))) {
              hasTransparency = true;
            }
          }
        }
      }

      const extGState = resources.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
      if (extGState) {
        for (const [k] of extGState.entries()) {
          const gs = extGState.lookupMaybe(k, PDFDict);
          if (!gs) continue;
          const caFill = gs.get(PDFName.of('ca'));
          const caStroke = gs.get(PDFName.of('CA'));
          const smask = gs.get(PDFName.of('SMask'));
          const bm = gs.get(PDFName.of('BM'));
          if (
            (caFill instanceof PDFNumber && caFill.asNumber() < 0.999) ||
            (caStroke instanceof PDFNumber && caStroke.asNumber() < 0.999) ||
            (smask && smask.toString() !== '/None') ||
            (bm && bm.toString() !== '/Normal')
          ) {
            hasTransparency = true;
          }
        }
      }
    }

    // Inspect Page Group transparency
    const groupDict = pg.node.lookupMaybe(PDFName.of('Group'), PDFDict);
    if (groupDict?.get(PDFName.of('S'))?.toString() === '/Transparency') {
      hasTransparency = true;
    }

    // Inspect Annotations & Form Widgets
    const annotations: InspectedAnnotation[] = [];
    const formWidgets: InspectedFormWidget[] = [];
    const annots = pg.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
      for (let i = 0; i < annots.size(); i++) {
        const annotDict = annots.lookupMaybe(i, PDFDict);
        if (!annotDict) continue;
        const subtypeRaw = annotDict.get(PDFName.of('Subtype'))?.toString() || '';
        const subtype = subtypeRaw.replace(/^\//, '') || 'Unknown';
        const rectArr = annotDict.lookupMaybe(PDFName.of('Rect'), PDFArray);
        const rect = pdfArrayRectToTopLeft(rectArr, activeBox.height, activeBox.x, activeBox.y);
        if (!rect) continue;

        const contentsStr = annotDict.get(PDFName.of('Contents'))?.toString();
        const isWidget = subtype === 'Widget';
        const dictKey = annotDict.toString();
        const widgetInfo = widgetMetaByRef.get(dictKey);
        const rawT = annotDict.get(PDFName.of('T'))?.toString()?.replace(/^\(|\)$/g, '');
        const rawFT = annotDict.get(PDFName.of('FT'))?.toString()?.replace(/^\//, '');

        if (isWidget) {
          let kind: InspectedFormWidget['kind'] = widgetInfo?.kind || 'text_input';
          if (!widgetInfo) {
            if (rawFT === 'Btn') kind = 'checkbox';
            else if (rawFT === 'Ch') kind = 'dropdown';
            else if (rawFT === 'Sig') kind = 'signature_field';
          }
          formWidgets.push({
            id: `form-p${pageNumber}-${i + 1}`,
            pageNumber,
            name: widgetInfo?.name || rawT || `field_${pageNumber}_${i + 1}`,
            kind,
            rect,
            value: widgetInfo?.value || '',
            checked: widgetInfo?.checked,
            options: widgetInfo?.options,
          });
          totalFormWidgets++;
        }

        annotations.push({
          pageNumber,
          subtype,
          rect,
          contents: contentsStr,
          fieldName: widgetInfo?.name || rawT,
          isWidget,
        });
        totalAnnotations++;
      }
    }

    return {
      pageNumber,
      widthPt,
      heightPt,
      rotation,
      boxes,
      embeddedFonts,
      imageResourceNames,
      hasTransparency,
      streamCount,
      annotations,
      formWidgets,
    };
  });

  return {
    pageCount,
    metadata,
    pages,
    totalEmbeddedFonts: allFonts.size,
    totalImageResources: allImages.size,
    totalAnnotations,
    totalFormWidgets,
  };
}
