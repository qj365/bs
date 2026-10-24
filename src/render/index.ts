import type { Backend } from '../config';
import type { Layout } from '../sim';
import { CpuRenderer } from './cpu';
import { GpuRenderer } from './renderer';
import type { AnyCanvas, FrameRenderer } from './types';

export type { FrameRenderer } from './types';

/**
 * Creates a renderer for the requested backend. "auto" tries the GPU first and
 * falls back to the CPU. A canvas that failed to give a WebGL context can't be
 * reused for 2D, so `makeCanvas` is called again for the fallback.
 */
export function createRenderer(backend: Backend, makeCanvas: () => AnyCanvas, layout: Layout): FrameRenderer {
  if (backend !== 'cpu') {
    const canvas = makeCanvas();
    try {
      return new GpuRenderer(canvas, layout);
    } catch (err) {
      if (backend === 'gpu') throw err;
      console.warn('WebGL2 renderer unavailable, falling back to CPU:', err);
    }
  }
  return new CpuRenderer(makeCanvas(), layout);
}
