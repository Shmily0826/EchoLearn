// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCaptionRequest } from './useCaptionRequest';

describe('useCaptionRequest', () => {
  it('exposes preflight input failures as visible error state', () => {
    const { result } = renderHook(() => useCaptionRequest());

    act(() => result.current.fail('Enter a valid YouTube or Bilibili video URL or ID.'));

    expect(result.current.error).toBe('Enter a valid YouTube or Bilibili video URL or ID.');
    expect(result.current.fetching).toBe(false);
  });

  it('keeps an invalid-input failure current after invalidating an older request', async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((res) => { resolve = res; });
    const { result } = renderHook(() => useCaptionRequest());

    act(() => result.current.run(() => pending));
    act(() => {
      result.current.invalidate();
      result.current.fail('Enter a valid YouTube or Bilibili video URL or ID.');
    });

    await act(async () => {
      resolve('late transcript');
      await pending;
    });

    expect(result.current.error).toBe('Enter a valid YouTube or Bilibili video URL or ID.');
    expect(result.current.fetching).toBe(false);
  });
});
