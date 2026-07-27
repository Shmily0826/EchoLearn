import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useI18n } from '../i18n/I18nContext';

const TOUR_KEY = 'echolearn-tour-completed-v1';

const FirstTimeTour: React.FC = () => {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const startedRef = useRef(false);

  useEffect(() => {
    if (pathname !== '/') return;
    if (localStorage.getItem(TOUR_KEY)) return;
    if (startedRef.current) return;
    startedRef.current = true;

    // Wait for the Dashboard DOM to settle before attaching the tour.
    const timer = setTimeout(() => {
      const required = [
        '#tour-channel-card',
        '#tour-today-plan',
        '#tour-review-card',
      ];
      const missing = required.some((sel) => !document.querySelector(sel));
      if (missing) return;

      const d = driver({
        showProgress: true,
        allowClose: true,
        overlayClickBehavior: 'close',
        showButtons: ['next', 'previous', 'close'],
        nextBtnText: t('tour.next'),
        prevBtnText: t('tour.prev'),
        doneBtnText: t('tour.done'),
        progressText: t('tour.progress'),
        steps: [
          {
            popover: {
              title: t('tour.welcomeTitle'),
              description: t('tour.welcomeBody'),
              side: 'bottom',
              align: 'center',
            },
          },
          {
            element: '#tour-channel-card',
            popover: {
              title: t('tour.channelTitle'),
              description: t('tour.channelBody'),
              side: 'bottom',
              align: 'start',
            },
          },
          {
            element: '#tour-today-plan',
            popover: {
              title: t('tour.planTitle'),
              description: t('tour.planBody'),
              side: 'top',
              align: 'start',
            },
          },
          {
            element: '#tour-review-card',
            popover: {
              title: t('tour.reviewTitle'),
              description: t('tour.reviewBody'),
              side: 'bottom',
              align: 'center',
            },
          },
          {
            popover: {
              title: t('tour.doneTitle'),
              description: t('tour.doneBody'),
              side: 'bottom',
              align: 'center',
            },
          },
        ],
        onDestroyed: () => {
          localStorage.setItem(TOUR_KEY, '1');
        },
      });

      d.drive();
    }, 700);

    return () => clearTimeout(timer);
  }, [pathname, t]);

  return null;
};

export default FirstTimeTour;
