import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import {
  syncWithCloud,
  uploadToCloud,
  getLastSyncTime,
  formatLastSync,
} from '../services/firestoreSync';
import {
  savePat,
  loadPat,
  clearPat,
  getSyncStatus,
  validatePat,
  saveToCloud,
  loadFromCloud,
  deleteCloudBackup,
} from '../services/syncService';
import type { SyncStatus } from '../services/syncService';
import {
  loadVocabulary,
  loadSentences,
  loadAllSessions,
  getLocalProxyUrl,
  saveLocalProxyUrl,
  clearLocalProxyUrl,
  checkLocalProxy,
} from '../utils/storage';
import {
  exportVocabularyCSV,
  exportSentencesCSV,
  exportAllDataJSON,
} from '../services/exportService';

// ── Local data size helper ────────────────────────────────────

function useLocalDataSize() {
  const [size, setSize] = useState({ vocab: 0, sentences: 0, sessions: 0 });
  useEffect(() => {
    setSize({
      vocab: loadVocabulary().length,
      sentences: loadSentences().length,
      sessions: loadAllSessions().length,
    });
  }, []);
  return size;
}

// ── Settings Page ─────────────────────────────────────────────

const SettingsPage: React.FC = () => {
  const dataSize = useLocalDataSize();
  const { user, logOut } = useAuth();
  const { t } = useI18n();

  // ── Firebase sync state ──────────────────────────────────
  const [fbSyncAction, setFbSyncAction] = useState<'idle' | 'syncing' | 'uploading'>('idle');
  const [fbSyncMessage, setFbSyncMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(getLastSyncTime());

  // ── PAT state ─────────────────────────────────────────────
  const [patInput, setPatInput] = useState('');
  const [savedPat, setSavedPat] = useState('');
  const [patStatus, setPatStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [patMessage, setPatMessage] = useState('');
  const [showPat, setShowPat] = useState(false);

  // ── Sync state ────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ hasPat: false, gistId: null, lastSyncAt: null });
  const [syncAction, setSyncAction] = useState<'idle' | 'saving' | 'loading' | 'deleting'>('idle');
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // ── Local proxy state ─────────────────────────────────────
  const [proxyUrl, setProxyUrl] = useState(getLocalProxyUrl());
  const [proxyStatus, setProxyStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [proxyMessage, setProxyMessage] = useState('');

  // Initialise on mount
  useEffect(() => {
    const pat = loadPat();
    setSavedPat(pat);
    setPatInput(pat);
    setSyncStatus(getSyncStatus());
    if (pat) {
      setPatStatus('valid');
    }

    // Auto-check local proxy status
    checkLocalProxy().then((result) => {
      setProxyStatus(result.ok ? 'online' : 'offline');
      setProxyMessage(result.ok ? 'Proxy is running' : (result.error || 'Not reachable'));
    });

    // Auto-sync with cloud on mount (if user is logged in)
    if (user?.uid) {
      setFbSyncAction('syncing');
      syncWithCloud(user.uid).then((result) => {
        setFbSyncAction('idle');
        if (result.ok) {
          setLastSync(getLastSyncTime());
        }
      });
    }
  }, [user?.uid]);

  // ── Firebase sync now ─────────────────────────────────────
  const handleSyncNow = useCallback(async () => {
    if (!user?.uid) return;
    setFbSyncAction('syncing');
    setFbSyncMessage({ type: 'info', text: 'Syncing with cloud...' });
    const result = await syncWithCloud(user.uid);
    setFbSyncAction('idle');
    if (result.ok) {
      const parts: string[] = [];
      if (result.counts) {
        if (result.counts.vocabulary) parts.push(`${result.counts.vocabulary} words`);
        if (result.counts.sentences) parts.push(`${result.counts.sentences} sentences`);
        if (result.counts.sessions) parts.push(`${result.counts.sessions} sessions`);
        if (result.counts.dailyPlan) parts.push(`${result.counts.dailyPlan} plan items`);
      }
      const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      setFbSyncMessage({ type: 'success', text: `Sync complete${detail}.` });
      setLastSync(getLastSyncTime());
    } else {
      setFbSyncMessage({ type: 'error', text: result.error || 'Sync failed.' });
    }
  }, [user?.uid]);

  // ── Firebase upload only ──────────────────────────────────
  const handleUploadOnly = useCallback(async () => {
    if (!user?.uid) return;
    setFbSyncAction('uploading');
    setFbSyncMessage({ type: 'info', text: 'Uploading local data to cloud...' });
    const result = await uploadToCloud(user.uid);
    setFbSyncAction('idle');
    if (result.ok) {
      setFbSyncMessage({ type: 'success', text: 'Local data uploaded to cloud.' });
      setLastSync(getLastSyncTime());
    } else {
      setFbSyncMessage({ type: 'error', text: result.error || 'Upload failed.' });
    }
  }, [user?.uid]);

  // ── Handle sign out ───────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    await logOut();
  }, [logOut]);

  // ── Check proxy status ────────────────────────────────────
  const handleCheckProxy = useCallback(async () => {
    setProxyStatus('checking');
    setProxyMessage('Checking...');
    const result = await checkLocalProxy();
    setProxyStatus(result.ok ? 'online' : 'offline');
    setProxyMessage(result.ok ? 'Proxy is running' : (result.error || 'Not reachable'));
  }, []);

  // ── Save proxy URL ───────────────────────────────────────
  const handleSaveProxyUrl = useCallback(() => {
    const trimmed = proxyUrl.trim();
    if (trimmed) {
      saveLocalProxyUrl(trimmed);
      setProxyUrl(trimmed);
      handleCheckProxy();
    }
  }, [proxyUrl, handleCheckProxy]);

  // ── Reset proxy URL ──────────────────────────────────────
  const handleResetProxyUrl = useCallback(() => {
    clearLocalProxyUrl();
    setProxyUrl(getLocalProxyUrl());
    setProxyStatus('idle');
    setProxyMessage('');
  }, []);

  // ── Save PAT ──────────────────────────────────────────────
  const handleSavePat = useCallback(async () => {
    const trimmed = patInput.trim();
    if (!trimmed) {
      setPatMessage(t('settings.patRequired'));
      setPatStatus('invalid');
      return;
    }

    setPatStatus('validating');
    setPatMessage(t('settings.patValidating'));

    const result = await validatePat(trimmed);
    if (result.ok) {
      savePat(trimmed);
      setSavedPat(trimmed);
      setPatStatus('valid');
      setPatMessage(t('settings.patConnected', { login: result.login ?? '' }));
      setSyncStatus(getSyncStatus());
    } else {
      setPatStatus('invalid');
      setPatMessage(result.error || t('settings.patFailed'));
    }
  }, [patInput, t]);

  // ── Remove PAT ────────────────────────────────────────────
  const handleRemovePat = useCallback(() => {
    clearPat();
    setPatInput('');
    setSavedPat('');
    setPatStatus('idle');
    setPatMessage('');
    setSyncStatus(getSyncStatus());
  }, []);

  // ── Save to cloud ─────────────────────────────────────────
  const handleSaveToCloud = useCallback(async () => {
    setSyncAction('saving');
    setSyncMessage({ type: 'info', text: t('settings.syncUploading') });

    const result = await saveToCloud();
    if (result.ok) {
      setSyncMessage({ type: 'success', text: t('settings.syncSaved') });
      setSyncStatus(getSyncStatus());
    } else {
      setSyncMessage({ type: 'error', text: result.error || t('settings.syncSaveFailed') });
    }
    setSyncAction('idle');
  }, [t]);

  // ── Load from cloud ───────────────────────────────────────
  const handleLoadFromCloud = useCallback(async () => {
    setSyncAction('loading');
    setSyncMessage({ type: 'info', text: t('settings.syncDownloading') });

    const result = await loadFromCloud();
    if (result.ok) {
      const parts: string[] = [];
      if (result.itemCounts) {
        for (const [key, count] of Object.entries(result.itemCounts)) {
          parts.push(`${key} ${count} ${t('settings.syncItemUnit')}`);
        }
      }
      const detail = parts.length > 0 ? parts.join(', ') : '';
      setSyncMessage({ type: 'success', text: t('settings.syncRestored', { detail }) });
      setSyncStatus(getSyncStatus());
      setTimeout(() => window.location.reload(), 2000);
    } else {
      setSyncMessage({ type: 'error', text: result.error || t('settings.syncLoadFailed') });
    }
    setSyncAction('idle');
  }, [t]);

  // ── Delete cloud backup ───────────────────────────────────
  const handleDeleteCloud = useCallback(async () => {
    if (!window.confirm(t('settings.syncDeleteConfirm'))) return;

    setSyncAction('deleting');
    setSyncMessage({ type: 'info', text: t('settings.syncDeleting') });

    const result = await deleteCloudBackup();
    if (result.ok) {
      setSyncMessage({ type: 'success', text: t('settings.syncDeleted') });
      setSyncStatus(getSyncStatus());
    } else {
      setSyncMessage({ type: 'error', text: result.error || t('settings.syncDeleteFailed') });
    }
    setSyncAction('idle');
  }, [t]);

  // ── Export helpers ─────────────────────────────────────────
  const handleExportVocabCSV = useCallback(() => {
    const items = loadVocabulary();
    if (items.length === 0) {
      setSyncMessage({ type: 'error', text: t('settings.exportNoVocab') });
      return;
    }
    exportVocabularyCSV(items);
    setSyncMessage({ type: 'success', text: t('settings.exportVocabOk', { n: items.length }) });
  }, [t]);

  const handleExportSentencesCSV = useCallback(() => {
    const items = loadSentences();
    if (items.length === 0) {
      setSyncMessage({ type: 'error', text: t('settings.exportNoSent') });
      return;
    }
    exportSentencesCSV(items);
    setSyncMessage({ type: 'success', text: t('settings.exportSentOk', { n: items.length }) });
  }, [t]);

  const handleExportAllJSON = useCallback(() => {
    exportAllDataJSON();
    setSyncMessage({ type: 'success', text: t('settings.exportAllOk') });
  }, [t]);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight mb-2">
        {t('settings.title')}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">
        {t('settings.subtitle')}
      </p>

      {/* ── Account Section ──────────────────────────────────── */}
      {user && (
        <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 sm:p-6 mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-violet-100 dark:bg-violet-950 rounded-lg">
              <svg className="w-5 h-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{t('settings.account')}</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {user.displayName || user.email || t('settings.signedIn')}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="ml-auto px-3 py-1.5 text-xs text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('settings.signOut')}
            </button>
          </div>

          {/* User info */}
          <div className="flex items-center gap-4 mb-4">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-12 h-12 rounded-full border-2 border-violet-200 dark:border-violet-800"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center">
                <span className="text-violet-600 dark:text-violet-300 font-semibold text-lg">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </span>
              </div>
            )}
            <div className="text-sm">
              {user.displayName && (
                <p className="font-medium text-gray-800 dark:text-gray-200">{user.displayName}</p>
              )}
              <p className="text-gray-400 dark:text-gray-500">{user.email}</p>
              {user.providerData[0]?.providerId === 'google.com' && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('settings.signedInGoogle')}</p>
              )}
            </div>
          </div>

          {/* Cloud sync status & actions */}
          <div className="border-t border-gray-100 dark:border-slate-700 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-gray-400 dark:text-gray-500">
                  {t('settings.lastSync')} <span className="text-gray-600 dark:text-gray-300">{formatLastSync(lastSync)}</span>
                </span>
              </div>
              {fbSyncAction !== 'idle' && (
                <span className="flex items-center gap-1.5 text-xs text-indigo-500">
                  <Spinner />
                  {fbSyncAction === 'syncing' ? t('settings.syncing') : t('settings.uploading')}
                </span>
              )}
            </div>

            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
              {t('settings.syncHint')}
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSyncNow}
                disabled={fbSyncAction !== 'idle'}
                className="flex-1 min-w-[120px] px-4 py-2.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {fbSyncAction === 'syncing' ? (
                  <>
                    <Spinner />
                    {t('settings.syncing')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
                    </svg>
                    {t('settings.syncNow')}
                  </>
                )}
              </button>

              <button
                onClick={handleUploadOnly}
                disabled={fbSyncAction !== 'idle'}
                className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-2"
              >
                {fbSyncAction === 'uploading' ? (
                  <>
                    <Spinner />
                    {t('settings.uploading')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    {t('settings.uploadLocal')}
                  </>
                )}
              </button>
            </div>

            {fbSyncMessage && (
              <p className={`text-xs mt-3 ${
                fbSyncMessage.type === 'success' ? 'text-green-600 dark:text-green-400' :
                fbSyncMessage.type === 'error' ? 'text-red-500' :
                'text-gray-500'
              }`}>
                {fbSyncMessage.text}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Local Proxy Section ──────────────────────────────── */}
      <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 sm:p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-950 rounded-lg">
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{t('settings.proxy')}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.proxyHint')}</p>
          </div>
          <span className={`ml-auto flex items-center gap-1.5 text-xs font-medium ${
            proxyStatus === 'online' ? 'text-green-600 dark:text-green-400' :
            proxyStatus === 'offline' ? 'text-red-500 dark:text-red-400' :
            proxyStatus === 'checking' ? 'text-amber-500 dark:text-amber-400' :
            'text-gray-400 dark:text-gray-500'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              proxyStatus === 'online' ? 'bg-green-500' :
              proxyStatus === 'offline' ? 'bg-red-500' :
              proxyStatus === 'checking' ? 'bg-amber-500 animate-pulse' :
              'bg-gray-400'
            }`} />
            {proxyStatus === 'online' ? t('settings.online') :
             proxyStatus === 'offline' ? t('settings.offline') :
             proxyStatus === 'checking' ? t('settings.checking') :
             t('settings.unknown')}
          </span>
        </div>

        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          {t('settings.proxyDesc')}
          See <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded text-[10px]">local-proxy/</code> folder for setup instructions.
        </p>

        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
            {t('settings.proxyUrl')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => {
                setProxyUrl(e.target.value);
                if (proxyStatus !== 'idle') {
                  setProxyStatus('idle');
                  setProxyMessage('');
                }
              }}
              placeholder="http://127.0.0.1:8787"
              className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg bg-transparent text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-colors font-mono"
            />
            <button
              onClick={handleSaveProxyUrl}
              className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('settings.save')}
            </button>
            <button
              onClick={handleCheckProxy}
              disabled={proxyStatus === 'checking'}
              className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {proxyStatus === 'checking' ? '...' : t('settings.test')}
            </button>
            <button
              onClick={handleResetProxyUrl}
              className="px-3 py-2 text-xs text-gray-400 border border-gray-200 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('settings.reset')}
            </button>
          </div>
          {proxyMessage && (
            <p className={`text-xs mt-2 ${
              proxyStatus === 'online' ? 'text-green-600 dark:text-green-400' :
              proxyStatus === 'offline' ? 'text-red-500' :
              'text-gray-500'
            }`}>
              {proxyStatus === 'online' && (
                <svg className="w-3 h-3 inline mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {proxyMessage}
            </p>
          )}
        </div>

        <details className="text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            {t('settings.howSetup')}
          </summary>
          <div className="mt-2 space-y-1.5 text-[11px] pl-3 border-l-2 border-gray-100 dark:border-slate-700">
            <p>1. Open a terminal in the <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">EchoLearn/local-proxy</code> folder</p>
            <p>2. Run: <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">npm install</code></p>
            <p>3a. Local only: <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">npm start</code> — use <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">http://127.0.0.1:8787</code> on this computer</p>
            <p>3b. With tunnel: <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">npm run tunnel</code> — get a public URL usable from any device</p>
            <p>4. Keep the proxy running while using EchoLearn</p>
            <p className="text-gray-400 dark:text-gray-500 pt-1">
              On Windows: double-click <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">start.bat</code> (local) or <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded">start-tunnel.bat</code> (with tunnel).
            </p>
          </div>
        </details>
      </section>

      {/* ── Cloud Sync Section ──────────────────────────────── */}
      <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 sm:p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-950 rounded-lg">
            <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{t('settings.cloudSync')}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.cloudHint')}</p>
          </div>
        </div>

        {/* PAT Input */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
            {t('settings.githubPat')}
          </label>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
            Create one at{' '}
            <a
              href="https://github.com/settings/tokens/new?description=EchoLearn&scopes=gist"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline"
            >
              github.com/settings/tokens
            </a>
            {' '}— only <code className="px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded text-[10px]">gist</code> scope is needed.
          </p>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPat ? 'text' : 'password'}
                value={patInput}
                onChange={(e) => {
                  setPatInput(e.target.value);
                  if (patStatus === 'valid') {
                    setPatStatus('idle');
                    setPatMessage('');
                  }
                }}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg bg-transparent text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPat(!showPat)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
              >
                {showPat ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>

            {savedPat && patStatus === 'valid' && patInput === savedPat ? (
              <button
                onClick={handleRemovePat}
                className="px-3 py-2 text-xs text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t('settings.remove')}
              </button>
            ) : (
              <button
                onClick={handleSavePat}
                disabled={patStatus === 'validating'}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {patStatus === 'validating' ? t('login.waiting') : t('settings.save')}
              </button>
            )}
          </div>

          {patMessage && (
            <p className={`text-xs mt-2 ${
              patStatus === 'valid' ? 'text-green-600' :
              patStatus === 'invalid' ? 'text-red-500' :
              'text-gray-500'
            }`}>
              {patStatus === 'valid' && (
                <svg className="w-3 h-3 inline mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {patMessage}
            </p>
          )}
        </div>

        {/* Sync Actions */}
        {savedPat && (
          <div className="space-y-3">
            {/* Sync status */}
            {syncStatus.lastSyncAt && (
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  {t('settings.lastSync')} {new Date(syncStatus.lastSyncAt).toLocaleString()}
                </span>
                {syncStatus.gistId && (
                  <a
                    href={`https://gist.github.com/${syncStatus.gistId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-500 hover:underline ml-1"
                  >
                    {t('settings.viewGist')}
                  </a>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSaveToCloud}
                disabled={syncAction !== 'idle'}
                className="flex-1 min-w-[120px] px-4 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {syncAction === 'saving' ? (
                  <>
                    <Spinner />
                    {t('settings.uploading')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    {t('settings.saveToCloud')}
                  </>
                )}
              </button>

              <button
                onClick={handleLoadFromCloud}
                disabled={syncAction !== 'idle'}
                className="flex-1 min-w-[120px] px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {syncAction === 'loading' ? (
                  <>
                    <Spinner />
                    {t('settings.syncing')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    {t('settings.restoreCloud')}
                  </>
                )}
              </button>

              {syncStatus.gistId && (
                <button
                  onClick={handleDeleteCloud}
                  disabled={syncAction !== 'idle'}
                  className="px-4 py-2.5 text-sm text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {syncAction === 'deleting' ? t('settings.syncing') : t('settings.deleteCloud')}
                </button>
              )}
            </div>

            {/* Warning about load */}
            <p className="text-[11px] text-amber-500 dark:text-amber-400">
              {t('settings.syncWarning')}
            </p>
          </div>
        )}
      </section>

      {/* ── Data Export Section ──────────────────────────────── */}
      <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 sm:p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-amber-100 dark:bg-amber-950 rounded-lg">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{t('settings.dataExport')}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.exportHint')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            onClick={handleExportVocabCSV}
            className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer text-left"
          >
            <span className="block font-medium">Vocabulary CSV</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{dataSize.vocab} words</span>
          </button>
          <button
            onClick={handleExportSentencesCSV}
            className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer text-left"
          >
            <span className="block font-medium">Sentences CSV</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{dataSize.sentences} sentences</span>
          </button>
          <button
            onClick={handleExportAllJSON}
            className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer text-left"
          >
            <span className="block font-medium">All Data (JSON)</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('settings.fullBackup')}</span>
          </button>
        </div>
      </section>

      {/* ── About Section ───────────────────────────────────── */}
      <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gray-100 dark:bg-slate-700 rounded-lg">
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{t('settings.about')}</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.aboutDesc')}</p>
          </div>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <p>
            All data is stored locally in your browser. Use Cloud Sync to back up
            your data to a private GitHub Gist, or export it as CSV / JSON.
          </p>
          <p className="flex items-center gap-3 mt-3">
            <a
              href="https://github.com/Shmily0826"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline inline-flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              GitHub
            </a>
            <a
              href="mailto:1014755473@qq.com"
              className="text-indigo-500 hover:underline"
            >
              1014755473@qq.com
            </a>
          </p>
        </div>
      </section>

      {/* ── Global sync message toast ───────────────────────── */}
      {syncMessage && (
        <div
          className={`fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:max-w-sm z-50 px-4 py-3 rounded-xl shadow-lg border text-sm flex items-start gap-2 ${
            syncMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : syncMessage.type === 'error'
                ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-600 dark:text-red-300'
                : 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300'
          }`}
        >
          {syncAction !== 'idle' ? (
            <Spinner />
          ) : syncMessage.type === 'success' ? (
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
          <span className="flex-1">{syncMessage.text}</span>
          <button
            onClick={() => setSyncMessage(null)}
            className="flex-shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

// ── Spinner ──────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default SettingsPage;
