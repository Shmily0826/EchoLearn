import { describe, expect, it } from 'vitest';
// Vite's raw import lets this contract test run in the browser-oriented
// TypeScript project without adding Node-only test types to the app build.
import source from '../../../cf-worker/src/index.js?raw';

describe('CF Worker transcript routing contract', () => {
  it('keeps all caption providers before the ASR block', () => {
    const providers = [
      'const innerTubeResult = await fetchViaInnerTube',
      'const webResult = await fetchViaWebPage',
      'const invidiousResult = await fetchViaInvidious',
      'const pipedResult = await fetchViaPiped',
    ].map((marker) => source.indexOf(marker));
    const asr = source.indexOf('if (allowAsr && env && env.YTDLP_API_URL)');

    expect(Math.min(...providers)).toBeGreaterThan(-1);
    expect(asr).toBeGreaterThan(Math.max(...providers));
  });

  it('requires explicit allowAsr=1 before generation paths', () => {
    expect(source).toContain("const allowAsr = url.searchParams.get('allowAsr') === '1'");
    expect(source).toContain("error: 'asr_required'");
    expect(source).toContain('} else if (allowAsr && env && env.GROQ_API_KEY)');
    expect(source).toContain('boundedProviderCall(');
    expect(source).toContain('clearTimeout(timer)');
    expect(source).toContain('captionProviderTimedOut = true');
    expect(source).toContain('const asrAvailable = !!(env && (env.YTDLP_API_URL || env.GROQ_API_KEY))');
  });
});
