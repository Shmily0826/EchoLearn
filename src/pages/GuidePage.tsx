import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';

interface Step {
  key: string;
  titleKey: string;
  bodyKey: string;
  icon: React.ReactNode;
}

const stepIcon = (path: React.ReactNode) => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
    {path}
  </svg>
);

const steps: Step[] = [
  {
    key: 's1',
    titleKey: 'guide.s1Title',
    bodyKey: 'guide.s1Body',
    icon: stepIcon(
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14.66V17a2 2 0 002 2h.34M14 9.34V7a2 2 0 00-2-2h-.34M15 9.34l1.66-1.66A2 2 0 0119.32 9.7l-1.7 1.64M9 14.66L7.34 16.32A2 2 0 014.68 14.3l1.7-1.64" />
      </>,
    ),
  },
  {
    key: 's2',
    titleKey: 'guide.s2Title',
    bodyKey: 'guide.s2Body',
    icon: stepIcon(
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </>,
    ),
  },
  {
    key: 's3',
    titleKey: 'guide.s3Title',
    bodyKey: 'guide.s3Body',
    icon: stepIcon(
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
      </>,
    ),
  },
  {
    key: 's4',
    titleKey: 'guide.s4Title',
    bodyKey: 'guide.s4Body',
    icon: stepIcon(
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0V11.25A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </>,
    ),
  },
  {
    key: 's5',
    titleKey: 'guide.s5Title',
    bodyKey: 'guide.s5Body',
    icon: stepIcon(
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </>,
    ),
  },
];

const tips: string[] = ['guide.tip1', 'guide.tip2', 'guide.tip3'];

const GuidePage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {t('guide.title')}
        </h1>
        <p className="mt-3 text-gray-500 dark:text-gray-400 max-w-xl mx-auto leading-relaxed text-sm sm:text-base">
          {t('guide.subtitle')}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/study')}
            className="px-5 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium cursor-pointer"
          >
            {t('guide.startBtn')}
          </button>
          <button
            onClick={() => navigate('/')}
            className="px-5 py-2.5 text-sm rounded-lg border transition-colors font-medium cursor-pointer"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            {t('guide.backBtn')}
          </button>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, idx) => (
          <div
            key={step.key}
            className="flex gap-4 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5"
          >
            <div className="flex flex-col items-center shrink-0">
              <span
                className="flex items-center justify-center w-11 h-11 rounded-full text-indigo-600 dark:text-indigo-300"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                {step.icon}
              </span>
              {idx < steps.length - 1 && (
                <span className="w-px flex-1 mt-2 bg-gray-200 dark:bg-slate-700" />
              )}
            </div>
            <div className="pt-1.5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t(step.titleKey)}
              </h2>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {t(step.bodyKey)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Pro tips */}
      <div className="mt-8 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30 rounded-xl border border-indigo-200 dark:border-indigo-800 p-5">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
          <span>💡</span> {t('guide.tipsTitle')}
        </h2>
        <ul className="space-y-2">
          {tips.map((key) => (
            <li key={key} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Privacy note */}
      <p className="mt-6 text-xs text-center text-gray-400 dark:text-gray-500 leading-relaxed">
        {t('guide.privacy')}
      </p>
    </div>
  );
};

export default GuidePage;
