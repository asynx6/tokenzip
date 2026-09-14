// Providers do their own downscale before tokenizing. Anything you send
// beyond that effective size costs the SAME tokens but wastes bytes and
// upload latency. tokenzip computes the exact effective size per provider
// and (for budget mode) the largest downscale that fits a token cap —
// re-encoded with zero vision-quality loss.

import { PROVIDERS } from './tokens.js';

export function tokensAt(provider, w, h) {
  if (w < 1 || h < 1) return 0;
  return PROVIDERS[provider].fn(w, h);
}

function aspectScale(w, h, targetArea) {
  const r = Math.sqrt(targetArea / (w * h));
  if (r >= 1) return { w, h };
  return { w: Math.max(1, Math.floor(w * r)), h: Math.max(1, Math.floor(h * r)) };
}

/** The size the provider model actually sees for input w×h (its internal resize). */
export function effectiveSize(provider, w, h) {
  if (provider === 'openai') {
    let width = w, height = h;
    const longest = Math.max(width, height);
    if (longest > 2048) {
      const r = 2048 / longest;
      width = Math.round(width * r);
      height = Math.round(height * r);
    }
    const shortest = Math.min(width, height);
    if (shortest > 768) {
      const r = 768 / shortest;
      width = Math.round(width * r);
      height = Math.round(height * r);
    }
    return { w: width, h: height };
  }
  if (provider === 'anthropic') {
    let width = w, height = h;
    const longest = Math.max(width, height);
    if (longest > 8000) {
      const r = 8000 / longest;
      width = Math.round(width * r);
      height = Math.round(height * r);
    }
    // cap ≈ 1568 tokens ≈ 1568*750 px area (Anthropic downscales >1.15MP)
    return aspectScale(width, height, 1568 * 750);
  }
  // gemini tiles the raw image (no global downscale): model sees what you send
  return { w, h };
}

/**
 * @param provider key of PROVIDERS
 * @param w,h original dims
 * @param opts  { maxTokens } shrink-to-budget cap (cost mode) or omit (bytes mode)
 */
export function optimize(provider, w, h, { maxTokens = null } = {}) {
  const tokens = tokensAt(provider, w, h);

  if (maxTokens) {
    // largest area whose billed tokens fit maxTokens
    let lo = 1, hi = w * h, best = null;
    const effTarget = () => {
      if (!best) return null;
      return best;
    };
    while (lo <= hi) {
      const mid = lo + ((hi - lo) >> 1);
      const fit = aspectScale(w, h, mid);
      if (tokensAt(provider, fit.w, fit.h) <= maxTokens) {
        best = fit;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const out = best || effectiveSize(provider, w, h);
    const t2 = tokensAt(provider, out.w, out.h);
    return {
      mode: 'budget',
      original: { w, h, tokens },
      best: { ...out, tokens: t2 },
      savedTokens: tokens - t2,
      pixelRatio: (out.w * out.h) / (w * h),
      note: t2 <= maxTokens ? `fits ${maxTokens}-token budget` : 'cannot fit budget — already at provider floor',
    };
  }

  const eff = effectiveSize(provider, w, h);
  const sameTokens = tokensAt(provider, eff.w, eff.h) === tokens;
  return {
    mode: 'exact',
    original: { w, h, tokens },
    best: { ...eff, tokens },
    savedTokens: 0,
    pixelRatio: (eff.w * eff.h) / (w * h),
    note: sameTokens
      ? `send ${eff.w}×${eff.h}: identical tokens & detail, ${Math.round((1 - (eff.w * eff.h) / (w * h)) * 100)}% fewer bytes`
      : 'provider already sees full size',
  };
}
