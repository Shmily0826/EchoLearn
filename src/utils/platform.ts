/**
 * Detects if the app is running inside a Capacitor native WebView.
 * Safe to call from any context — returns false in regular browsers.
 */
export function isCapacitor(): boolean {
  const win = window as any;
  return (
    typeof win.Capacitor !== 'undefined' &&
    win.Capacitor.isNativePlatform?.() === true
  );
}
