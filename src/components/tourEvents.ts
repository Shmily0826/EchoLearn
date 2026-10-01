// Shared event name used to (re)start the first-time tour from anywhere
// (Settings "replay guide" button, or the first-time language chooser).
export const TOUR_START_EVENT = 'echolearn:start-tour';
export const TOUR_LANG_CHOSEN_KEY = 'echolearn-lang-chosen';
// Set when the user explicitly skipped the language chooser — suppresses the
// auto-start timer. Settings → "Replay guide" (force) still always works.
export const TOUR_SKIPPED_KEY = 'echolearn-tour-skipped';
