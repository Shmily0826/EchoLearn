// Shared event name used to (re)start the first-time tour from anywhere.
// Settings "replay guide" dispatches it as a plain Event → force restart.
// The first-time language chooser dispatches CustomEvent(force: false) so a
// pre-completed tour (tests, replay users re-picking a language) is honored.
export const TOUR_START_EVENT = 'echolearn:start-tour';

export function dispatchTourStart(force: boolean): void {
  if (force) {
    window.dispatchEvent(new Event(TOUR_START_EVENT));
  } else {
    window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: { force: false } }));
  }
}

export const TOUR_LANG_CHOSEN_KEY = 'echolearn-lang-chosen';
// Set when the user explicitly skipped the language chooser — suppresses the
// auto-start timer. Settings → "Replay guide" (force) still always works.
export const TOUR_SKIPPED_KEY = 'echolearn-tour-skipped';
