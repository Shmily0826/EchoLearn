import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { driver } from 'driver.js';
import type { Config } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useI18n } from '../i18n/I18nContext';
import { TOUR_START_EVENT, TOUR_LANG_CHOSEN_KEY } from './tourEvents';

const TOUR_KEY = 'echolearn-tour-completed-v1';

// Scroll the highlighted element into the centre of the viewport before
// driver.js draws the cut-out. This fixes the highlight box landing in the
// wrong place when the target is far down the page or inside a scroll area.
const scrollIntoCenter: Config['onHighlighted'] = (element) => {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
};

// Some tour anchors (e.g. the Analyze button) exist twice — a mobile-only and a
// desktop-only copy. Return the one that is actually rendered/visible, so the
// highlight box never lands on a display:none element.
const pickVisible = (selector: string): HTMLElement | null => {
  const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
};

const FirstTimeTour: React.FC = () => {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tourRunningRef = useRef(false);
  const skippedRef = useRef(false);

  useEffect(() => {
    const tt = t;

    const buildStudySteps = (): NonNullable<Config['steps']> => {
      const steps: NonNullable<Config['steps']> = [];

      if (document.querySelector('#tour-study-url')) {
        steps.push({
          element: '#tour-study-url',
          popover: {
            title: tt('tour.studyUrlTitle'),
            description: tt('tour.studyUrlBody'),
            side: 'bottom',
            align: 'start',
          },
        });
      }
      if (document.querySelector('#tour-study-load')) {
        steps.push({
          element: '#tour-study-load',
          popover: {
            title: tt('tour.studyLoadTitle'),
            description: tt('tour.studyLoadBody'),
            side: 'bottom',
            align: 'start',
          },
        });
      }
      const controlsEl = pickVisible('[data-tour="study-controls"]');
      const analyzeEl = pickVisible('[data-tour="study-ai"]');
      const wordEl = document.querySelector('#tour-transcript-save-word') as HTMLElement | null;
      const sentenceEl = document.querySelector('#tour-transcript-save-sentence') as HTMLElement | null;

      if (controlsEl) {
        steps.push({
          element: controlsEl,
          popover: {
            title: tt('tour.studyControlsTitle'),
            description: tt('tour.studyControlsBody'),
            side: 'bottom',
            align: 'start',
          },
        });
      }
      if (analyzeEl) {
        steps.push({
          element: analyzeEl,
          popover: {
            title: tt('tour.studyAnalyzeTitle'),
            description: tt('tour.studyAnalyzeBody'),
            side: 'top',
            align: 'start',
          },
        });
      }
      if (wordEl) {
        steps.push({
          element: wordEl,
          popover: {
            title: tt('tour.studySaveTitle'),
            description: tt('tour.studySaveBody'),
            side: 'top',
            align: 'start',
          },
        });
      }
      if (sentenceEl) {
        steps.push({
          element: sentenceEl,
          popover: {
            title: tt('tour.studySaveSentenceTitle'),
            description: tt('tour.studySaveSentenceBody'),
            side: 'top',
            align: 'start',
          },
        });
      }
      // When no video is loaded yet, explain the save / analyse actions anyway.
      if (!controlsEl && !analyzeEl && !wordEl && !sentenceEl) {
        steps.push({
          popover: {
            title: tt('tour.studySaveTitle'),
            description: tt('tour.studySaveBody'),
            side: 'bottom',
            align: 'center',
          },
        });
      }
      steps.push({
        popover: {
          title: tt('tour.studyDoneTitle'),
          description: tt('tour.studyDoneBody'),
          side: 'bottom',
          align: 'center',
        },
      });
      return steps;
    };

    const runStudyTour = () => {
      window.scrollTo(0, 0);
      skippedRef.current = false;
      let attempts = 0;
      const tryBuild = () => {
        const steps = buildStudySteps();
        // The transcript-dependent controls (level/counts), the Analyze button,
        // and the save buttons only render once a transcript is loaded. On a
        // fresh visit the sample video is still fetching, so wait briefly and
        // retry before falling back to the centred explanation.
        const transcriptReady = !!(
          pickVisible('[data-tour="study-controls"]') ||
          pickVisible('[data-tour="study-ai"]') ||
          document.querySelector('#tour-transcript-save-word') ||
          document.querySelector('#tour-transcript-save-sentence')
        );
        if (!transcriptReady && attempts < 16) {
          attempts += 1;
          window.setTimeout(tryBuild, 500);
          return;
        }
        if (steps.length === 0) return;
        const d = driver({
          showProgress: true,
          allowClose: true,
          overlayClickBehavior: 'close',
          showButtons: ['next', 'previous', 'close'],
          nextBtnText: tt('tour.next'),
          prevBtnText: tt('tour.prev'),
          doneBtnText: tt('tour.done'),
          progressText: tt('tour.progress'),
          onHighlighted: scrollIntoCenter,
          onCloseClick: () => { skippedRef.current = true; d.destroy(); },
          steps,
          onDestroyed: () => {
            localStorage.setItem(TOUR_KEY, '1');
            tourRunningRef.current = false;
          },
        });
        d.drive();
      };
      tryBuild();
    };

    const runDashboardTour = () => {
      window.scrollTo(0, 0);
      skippedRef.current = false;
      const d = driver({
        showProgress: true,
        allowClose: true,
        overlayClickBehavior: 'close',
        showButtons: ['next', 'previous', 'close'],
        nextBtnText: tt('tour.next'),
        prevBtnText: tt('tour.prev'),
        doneBtnText: tt('tour.done'),
        progressText: tt('tour.progress'),
        onHighlighted: scrollIntoCenter,
        onCloseClick: () => { skippedRef.current = true; d.destroy(); },
        steps: [
          {
            popover: {
              title: tt('tour.welcomeTitle'),
              description: tt('tour.welcomeBody'),
              side: 'bottom',
              align: 'center',
            },
          },
          {
            element: '#tour-channel-card',
            popover: {
              title: tt('tour.channelTitle'),
              description: tt('tour.channelBody'),
              side: 'bottom',
              align: 'start',
            },
          },
          {
            element: '#tour-today-plan',
            popover: {
              title: tt('tour.planTitle'),
              description: tt('tour.planBody'),
              side: 'top',
              align: 'start',
            },
          },
          {
            element: '#tour-review-card',
            popover: {
              title: tt('tour.reviewTitle'),
              description: tt('tour.reviewBody'),
              side: 'bottom',
              align: 'center',
            },
          },
          {
            popover: {
              title: tt('tour.doneTitle'),
              description: tt('tour.doneBody'),
              side: 'bottom',
              align: 'center',
            },
          },
        ],
        onDestroyed: () => {
          localStorage.setItem(TOUR_KEY, '1');
          tourRunningRef.current = false;
          // Skip means the user opted out → don't continue to the Study page.
          if (skippedRef.current) return;
          // Continue the tour on the Study page.
          navigate('/study');
          window.setTimeout(runStudyTour, 650);
        },
      });
      d.drive();
    };

    const startTour = (force = false) => {
      if (tourRunningRef.current) return;
      const completed = localStorage.getItem(TOUR_KEY);
      if (!force && completed) return;
      const chosen = localStorage.getItem(TOUR_LANG_CHOSEN_KEY);
      if (!force && !chosen) return; // wait for the language chooser
      tourRunningRef.current = true;
      if (force) localStorage.removeItem(TOUR_KEY);
      const begin = () => runDashboardTour();
      if (pathname !== '/') {
        navigate('/');
        window.setTimeout(begin, 650);
      } else {
        begin();
      }
    };

    const handler = () => startTour(true);
    window.addEventListener(TOUR_START_EVENT, handler);

    let timer: number | undefined;
    if (
      pathname === '/' &&
      !localStorage.getItem(TOUR_KEY) &&
      localStorage.getItem(TOUR_LANG_CHOSEN_KEY)
    ) {
      timer = window.setTimeout(() => startTour(false), 700);
    }

    return () => {
      window.removeEventListener(TOUR_START_EVENT, handler);
      if (timer) window.clearTimeout(timer);
    };
  }, [t, pathname, navigate]);

  return null;
};

export default FirstTimeTour;
