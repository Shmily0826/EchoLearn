import { useState, useEffect, useCallback } from 'react';
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

  // Initialise on mount
  useEffect(() => {
    const pat = loadPat();
    setSavedPat(pat);
    setPatInput(pat);
    setSyncStatus(getSyncStatus());
    if (pat) {
      setPatStatus('valid');
    }
  }, []);

  // ── Save PAT ──────────────────────────────────────────────
  const handleSavePat = useCallback(async () => {
    const trimmed = patInput.trim();
    if (!trimmed) {
      setPatMessage('请输入 GitHub PAT');
      setPatStatus('invalid');
      return;
    }

    setPatStatus('validating');
    setPatMessage('正在验证...');

    const result = await validatePat(trimmed);
    if (result.ok) {
      savePat(trimmed);
      setSavedPat(trimmed);
      setPatStatus('valid');
      setPatMessage(`已连接到 ${result.login}`);
      setSyncStatus(getSyncStatus());
    } else {
      setPatStatus('invalid');
      setPatMessage(result.error || '验证失败');
    }
  }, [patInput]);

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
    setSyncMessage({ type: 'info', text: '正在上传数据到云端...' });

    const result = await saveToCloud();
    if (result.ok) {
      setSyncMessage({ type: 'success', text: '数据已保存到云端！' });
      setSyncStatus(getSyncStatus());
    } else {
      setSyncMessage({ type: 'error', text: result.error || '保存失败' });
    }
    setSyncAction('idle');
  }, []);

  // ── Load from cloud ───────────────────────────────────────
  const handleLoadFromCloud = useCallback(async () => {
    setSyncAction('loading');
    setSyncMessage({ type: 'info', text: '正在从云端下载数据...' });

    const result = await loadFromCloud();
    if (result.ok) {
      const parts: string[] = [];
      if (result.itemCounts) {
        for (const [key, count] of Object.entries(result.itemCounts)) {
          parts.push(`${key} ${count} 条`);
        }
      }
      const detail = parts.length > 0 ? `（${parts.join('、')}）` : '';
      setSyncMessage({ type: 'success', text: `数据已从云端恢复${detail}。刷新页面后生效。` });
      setSyncStatus(getSyncStatus());
    } else {
      setSyncMessage({ type: 'error', text: result.error || '加载失败' });
    }
    setSyncAction('idle');
  }, []);

  // ── Delete cloud backup ───────────────────────────────────
  const handleDeleteCloud = useCallback(async () => {
    if (!window.confirm('确定要删除云端备份吗？此操作不可撤销。')) return;

    setSyncAction('deleting');
    setSyncMessage({ type: 'info', text: '正在删除云端备份...' });

    const result = await deleteCloudBackup();
    if (result.ok) {
      setSyncMessage({ type: 'success', text: '云端备份已删除。' });
      setSyncStatus(getSyncStatus());
    } else {
      setSyncMessage({ type: 'error', text: result.error || '删除失败' });
    }
    setSyncAction('idle');
  }, []);

  // ── Export helpers ─────────────────────────────────────────
  const handleExportVocabCSV = useCallback(() => {
    const items = loadVocabulary();
    if (items.length === 0) {
      setSyncMessage({ type: 'error', text: '没有词汇数据可导出。' });
      return;
    }
    exportVocabularyCSV(items);
    setSyncMessage({ type: 'success', text: `已导出 ${items.length} 个词汇到 CSV。` });
  }, []);

  const handleExportSentencesCSV = useCallback(() => {
    const items = loadSentences();
    if (items.length === 0) {
      setSyncMessage({ type: 'error', text: '没有句子数据可导出。' });
      return;
    }
    exportSentencesCSV(items);
    setSyncMessage({ type: 'success', text: `已导出 ${items.length} 条句子到 CSV。` });
  }, []);

  const handleExportAllJSON = useCallback(() => {
    exportAllDataJSON();
    setSyncMessage({ type: 'success', text: '已导出全部数据为 JSON 文件。' });
  }, []);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight mb-2">
        Settings
      </h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">
        Manage your data sync and export preferences.
      </p>

      {/* ── Cloud Sync Section ──────────────────────────────── */}
      <section className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5 sm:p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-950 rounded-lg">
            <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Cloud Sync</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">Backup and restore via GitHub Gist</p>
          </div>
        </div>

        {/* PAT Input */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
            GitHub Personal Access Token
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
                Remove
              </button>
            ) : (
              <button
                onClick={handleSavePat}
                disabled={patStatus === 'validating'}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {patStatus === 'validating' ? '验证中...' : 'Save'}
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
                  上次同步: {new Date(syncStatus.lastSyncAt).toLocaleString()}
                </span>
                {syncStatus.gistId && (
                  <a
                    href={`https://gist.github.com/${syncStatus.gistId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-500 hover:underline ml-1"
                  >
                    查看 Gist
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
                    上传中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    保存到云端
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
                    下载中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    从云端恢复
                  </>
                )}
              </button>

              {syncStatus.gistId && (
                <button
                  onClick={handleDeleteCloud}
                  disabled={syncAction !== 'idle'}
                  className="px-4 py-2.5 text-sm text-red-500 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {syncAction === 'deleting' ? '删除中...' : '删除云端备份'}
                </button>
              )}
            </div>

            {/* Warning about load */}
            <p className="text-[11px] text-amber-500 dark:text-amber-400">
              注意：从云端恢复会用云端数据覆盖本地数据。建议先"保存到云端"或"导出 JSON"做好备份。
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
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Data Export</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">Download your learning data locally</p>
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
            <span className="text-xs text-gray-400 dark:text-gray-500">Full backup</span>
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
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">About EchoLearn</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">YouTube-based English learning workspace</p>
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
