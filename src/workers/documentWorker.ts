export interface WorkerRestorationParams {
  brightness: number;
  contrast: number;
  denoise: number;
  backgroundCleanup: number;
  whiteNormalize: boolean;
}

export function processRgbaBuffer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  params: WorkerRestorationParams
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels);
  const { brightness, contrast, denoise, backgroundCleanup, whiteNormalize } = params;

  // 1. Optional gentle 3x3 box denoise pass (preserves edges when blended by denoise/100)
  if (denoise > 0) {
    const strength = Math.min(1, denoise / 100);
    const src = new Uint8ClampedArray(out);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            rSum += src[nIdx];
            gSum += src[nIdx + 1];
            bSum += src[nIdx + 2];
          }
        }
        const rAvg = rSum / 9;
        const gAvg = gSum / 9;
        const bAvg = bSum / 9;
        out[idx] = Math.round(src[idx] * (1 - strength * 0.65) + rAvg * (strength * 0.65));
        out[idx + 1] = Math.round(
          src[idx + 1] * (1 - strength * 0.65) + gAvg * (strength * 0.65)
        );
        out[idx + 2] = Math.round(
          src[idx + 2] * (1 - strength * 0.65) + bAvg * (strength * 0.65)
        );
      }
    }
  }

  // 2. White background normalization percentile detection
  let whiteAnchor = 255;
  if (whiteNormalize) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < out.length; i += 16) {
      const lum = Math.round(0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]);
      hist[Math.max(0, Math.min(255, lum))]++;
    }
    let accum = 0;
    const sampleCount = Math.ceil(out.length / 16);
    const target = Math.floor(sampleCount * 0.88);
    for (let v = 0; v < 256; v++) {
      accum += hist[v];
      if (accum >= target) {
        whiteAnchor = Math.max(175, v);
        break;
      }
    }
  }

  const bOffset = (brightness / 100) * 95;
  const cVal = (contrast / 100) * 128;
  const cFactor = (259 * (cVal + 255)) / (255 * (259 - cVal));
  const bgThreshold = backgroundCleanup > 0 ? 255 - (backgroundCleanup / 100) * 85 : 256;
  const whiteScale = whiteAnchor < 255 ? 255 / whiteAnchor : 1;

  for (let i = 0; i < out.length; i += 4) {
    let r = out[i];
    let g = out[i + 1];
    let b = out[i + 2];

    if (whiteNormalize && whiteScale > 1) {
      r = Math.min(255, r * whiteScale);
      g = Math.min(255, g * whiteScale);
      b = Math.min(255, b * whiteScale);
    }

    r = cFactor * (r + bOffset - 128) + 128;
    g = cFactor * (g + bOffset - 128) + 128;
    b = cFactor * (b + bOffset - 128) + 128;

    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

    if (backgroundCleanup > 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum >= bgThreshold) {
        r = 255;
        g = 255;
        b = 255;
      }
    }

    out[i] = Math.round(r);
    out[i + 1] = Math.round(g);
    out[i + 2] = Math.round(b);
  }

  return out;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as {
      id: string;
      width: number;
      height: number;
      buffer: ArrayBuffer;
      params: WorkerRestorationParams;
    };
    const input = new Uint8ClampedArray(data.buffer);
    const result = processRgbaBuffer(input, data.width, data.height, data.params);
    (
      self as unknown as {
        postMessage: (msg: unknown, transfer?: Transferable[]) => void;
      }
    ).postMessage(
      { id: data.id, width: data.width, height: data.height, buffer: result.buffer },
      [result.buffer]
    );
  });
}
