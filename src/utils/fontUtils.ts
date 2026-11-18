import { AssetFontItem } from '../types/pdfStudio';

export interface ParsedFontMetadata {
  fontFamily: string;
  fsType?: number;
  embeddingPermission: AssetFontItem['embeddingPermission'];
  canEmbedInPdf: boolean;
  licenseNote: string;
  format: 'ttf' | 'otf' | 'woff';
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

export function interpretFsType(fsType: number): {
  permission: AssetFontItem['embeddingPermission'];
  canEmbedInPdf: boolean;
  licenseNote: string;
} {
  // OpenType OS/2 fsType bitmask rules:
  // Bits 0-3 (exclusive):
  // 0x0000: Installable Embedding
  // 0x0002: Restricted License embedding (NO embedding allowed)
  // 0x0004: Preview & Print embedding
  // 0x0008: Editable embedding
  // Bit 9 (0x0200): Bitmap embedding only (no outlines)
  if ((fsType & 0x0200) !== 0) {
    return {
      permission: 'restricted_bitmap',
      canEmbedInPdf: false,
      licenseNote: 'Font permits bitmap-only embedding (0x0200); vector PDF outline embedding disabled.',
    };
  }
  const usageBits = fsType & 0x000f;
  if (usageBits === 0x0002 || (fsType & 0x0002) !== 0) {
    return {
      permission: 'restricted_bitmap',
      canEmbedInPdf: false,
      licenseNote: 'Restricted License Embedding (fsType=0x0002): Font vendor forbids PDF embedding without separate license.',
    };
  }
  if ((usageBits & 0x0008) !== 0) {
    return {
      permission: 'editable',
      canEmbedInPdf: true,
      licenseNote: 'Editable Embedding permitted (fsType=0x0008).',
    };
  }
  if ((usageBits & 0x0004) !== 0) {
    return {
      permission: 'preview_print',
      canEmbedInPdf: true,
      licenseNote: 'Preview & Print Embedding permitted (fsType=0x0004).',
    };
  }
  return {
    permission: 'installable',
    canEmbedInPdf: true,
    licenseNote: 'Installable Embedding permitted (fsType=0x0000).',
  };
}

export function inspectFontBinary(
  bytes: Uint8Array,
  fileName: string
): ParsedFontMetadata {
  const lower = fileName.toLowerCase();
  const baseName = fileName.replace(/\.(ttf|otf|woff2?)$/i, '');
  const format: 'ttf' | 'otf' | 'woff' = lower.endsWith('.otf')
    ? 'otf'
    : lower.endsWith('.woff') || lower.endsWith('.woff2')
    ? 'woff'
    : 'ttf';

  if (format === 'woff' || bytes.byteLength < 12) {
    return {
      fontFamily: baseName,
      embeddingPermission: 'unknown',
      canEmbedInPdf: format !== 'woff',
      licenseNote:
        format === 'woff'
          ? 'WOFF is supported for canvas preview; upload .ttf or .otf for direct PDF embedding.'
          : 'Font metadata unavailable; verify vendor license before distribution.',
      format,
    };
  }

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numTables = view.getUint16(4, false);
    let os2Offset = -1;
    let nameOffset = -1;

    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      if (recOff + 16 > bytes.byteLength) break;
      const tag = readTag(view, recOff);
      const tblOffset = view.getUint32(recOff + 8, false);
      if (tag === 'OS/2') os2Offset = tblOffset;
      if (tag === 'name') nameOffset = tblOffset;
    }

    let fontFamily = baseName;
    if (nameOffset >= 0 && nameOffset + 6 <= bytes.byteLength) {
      const count = view.getUint16(nameOffset + 2, false);
      const strOffset = nameOffset + view.getUint16(nameOffset + 4, false);
      for (let i = 0; i < count; i++) {
        const nr = nameOffset + 6 + i * 12;
        if (nr + 12 > bytes.byteLength) break;
        const platformId = view.getUint16(nr, false);
        const nameId = view.getUint16(nr + 6, false);
        const length = view.getUint16(nr + 8, false);
        const offset = strOffset + view.getUint16(nr + 10, false);
        if (nameId === 1 && offset + length <= bytes.byteLength && length > 0) {
          if (platformId === 3 || platformId === 0) {
            // UTF-16BE
            let str = '';
            for (let j = 0; j + 1 < length; j += 2) {
              str += String.fromCharCode(view.getUint16(offset + j, false));
            }
            if (str.trim()) {
              fontFamily = str.trim();
              break;
            }
          } else if (platformId === 1) {
            let str = '';
            for (let j = 0; j < length; j++) {
              str += String.fromCharCode(view.getUint8(offset + j));
            }
            if (str.trim()) fontFamily = str.trim();
          }
        }
      }
    }

    if (os2Offset >= 0 && os2Offset + 10 <= bytes.byteLength) {
      const fsType = view.getUint16(os2Offset + 8, false);
      const interp = interpretFsType(fsType);
      return {
        fontFamily,
        fsType,
        embeddingPermission: interp.permission,
        canEmbedInPdf: interp.canEmbedInPdf,
        licenseNote: interp.licenseNote,
        format,
      };
    }

    return {
      fontFamily,
      embeddingPermission: 'unknown',
      canEmbedInPdf: true,
      licenseNote: 'No OS/2 fsType restriction flag found; verify vendor embedding rights.',
      format,
    };
  } catch {
    return {
      fontFamily: baseName,
      embeddingPermission: 'unknown',
      canEmbedInPdf: true,
      licenseNote: 'Font binary parsed with default embedding settings.',
      format,
    };
  }
}

const loadedFontIds = new Set<string>();

export async function registerBrowserFonts(fonts: AssetFontItem[]): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  for (const font of fonts) {
    if (loadedFontIds.has(font.id)) continue;
    loadedFontIds.add(font.id);
    try {
      const mime =
        font.format === 'otf'
          ? 'font/otf'
          : font.format === 'woff'
          ? 'font/woff'
          : 'font/ttf';
      const face = new FontFace(
        font.fontFamily,
        `url(data:${mime};base64,${font.dataBase64})`
      );
      await face.load();
      document.fonts.add(face);
    } catch {
      // Non-fatal fallback
    }
  }
}
