import { useEffect, useRef, useState } from 'react';

/**
 * Detects and actively reverses Google Translate's DOM modifications.
 *
 * Google Translate works by wrapping text nodes in <font> elements and
 * restructuring the DOM tree. This breaks React's internal DOM references,
 * causing errors like:
 *   "Failed to execute 'insertBefore' on 'Node': The node to be inserted
 *    before is not a child of this node."
 *
 * This hook uses a MutationObserver to watch the #root element and
 * immediately unwraps any <font> elements that Google Translate injects.
 */
export function useAntiTranslate() {
  const [translateDetected, setTranslateDetected] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    // ── Ensure notranslate attributes are present ──────────────────
    root.setAttribute('translate', 'no');
    root.classList.add('notranslate');

    // ── Check for existing Google Translate markers ───────────────
    const checkExisting = () => {
      // Google Translate adds a .skiptranslate iframe and modifies <font> tags
      const hasTranslateBar = document.querySelector('.skiptranslate');
      const hasFontTags = root.querySelector('font');
      if (hasTranslateBar || hasFontTags) {
        if (!dismissedRef.current) setTranslateDetected(true);
      }
    };
    checkExisting();

    // ── Unwrap <font> elements injected by Google Translate ───────
    const unwrapFont = (font: Element) => {
      const parent = font.parentNode;
      if (!parent) return;
      while (font.firstChild) {
        parent.insertBefore(font.firstChild, font);
      }
      parent.removeChild(font);
    };

    // ── MutationObserver: watch for Google Translate DOM changes ───
    const observer = new MutationObserver((mutations) => {
      let detected = false;
      const fontsToRemove: Element[] = [];

      for (const mutation of mutations) {
        // Check added nodes for <font> elements
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (el.tagName === 'FONT') {
              fontsToRemove.push(el);
              detected = true;
            }
            // Also check descendants
            const innerFonts = el.querySelectorAll?.('font');
            if (innerFonts?.length) {
              fontsToRemove.push(...Array.from(innerFonts));
              detected = true;
            }
          }
        }
      }

      // Remove all detected <font> wrappers
      for (const font of fontsToRemove) {
        try {
          unwrapFont(font);
        } catch {
          // Ignore if already removed
        }
      }

      if (detected && !dismissedRef.current) {
        setTranslateDetected(true);
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    // ── Periodic cleanup sweep (backup for mutations we might miss) ─
    const sweepInterval = setInterval(() => {
      const fonts = root.querySelectorAll('font');
      if (fonts.length > 0) {
        fonts.forEach((f) => {
          try {
            unwrapFont(f);
          } catch {
            // Ignore
          }
        });
        if (!dismissedRef.current) setTranslateDetected(true);
      }
    }, 2000);

    return () => {
      observer.disconnect();
      clearInterval(sweepInterval);
    };
  }, []);

  const dismissWarning = () => {
    dismissedRef.current = true;
    setTranslateDetected(false);
  };

  return { translateDetected, dismissWarning };
}
