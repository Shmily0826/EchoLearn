/**
 * Cloud sync via GitHub Gist.
 *
 * All user data (vocabulary, sentences, sessions, daily plan) is serialised
 * into a single JSON file inside a **secret** Gist. The user provides a
 * GitHub Personal Access Token (PAT) with `gist` scope.
 *
 * Flow:
 *   1. User enters PAT  → stored in localStorage (never leaves the device
 *      except for GitHub API calls).
 *   2. "Save to cloud"  → create or update a Gist named `echolearn-backup`.
 *   3. "Load from cloud" → fetch the Gist and restore data into localStorage.
 */

// ── Keys ───────────────────────────────────────────────────────
const PAT_KEY = 'echolearn_github_pat';
const GIST_ID_KEY = 'echolearn_gist_id';
const LAST_SYNC_KEY = 'echolearn_last_sync';

const GIST_FILENAME = 'echolearn-backup.json';
const GIST_DESCRIPTION = 'EchoLearn cloud backup (auto-managed — do not edit)';

// localStorage keys to sync (must match storage.ts)
const DATA_KEYS = [
  'echolearn_vocabulary',
  'echolearn_sentences',
  'echolearn_session',
  'echolearn_sessions_list',
  'echolearn_daily_plan',
] as const;

// ── Types ──────────────────────────────────────────────────────

interface GistFile {
  content: string;
  truncated?: boolean;
  raw_url?: string;
}

interface GistResponse {
  id: string;
  description: string;
  files: Record<string, GistFile>;
  updated_at: string;
}

interface SyncPayload {
  version: 1;
  exportedAt: number;
  data: Record<string, string | null>;
}

export interface SyncStatus {
  hasPat: boolean;
  gistId: string | null;
  lastSyncAt: number | null;
}

// ── PAT helpers ────────────────────────────────────────────────

export function savePat(token: string): void {
  localStorage.setItem(PAT_KEY, token.trim());
}

export function loadPat(): string {
  return localStorage.getItem(PAT_KEY) || '';
}

export function clearPat(): void {
  localStorage.removeItem(PAT_KEY);
  localStorage.removeItem(GIST_ID_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
}

// ── Status ─────────────────────────────────────────────────────

export function getSyncStatus(): SyncStatus {
  const pat = loadPat();
  const gistId = localStorage.getItem(GIST_ID_KEY);
  const lastSync = localStorage.getItem(LAST_SYNC_KEY);
  return {
    hasPat: pat.length > 0,
    gistId: gistId || null,
    lastSyncAt: lastSync ? Number(lastSync) : null,
  };
}

// ── Collect local data ─────────────────────────────────────────

function collectLocalData(): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  for (const key of DATA_KEYS) {
    data[key] = localStorage.getItem(key);
  }
  return data;
}

// ── Restore data ───────────────────────────────────────────────

function restoreLocalData(data: Record<string, string | null>): void {
  for (const key of DATA_KEYS) {
    const value = data[key];
    if (value !== null && value !== undefined) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  }
}

// ── GitHub API helpers ─────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';

async function ghFetch(path: string, pat: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${pat}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init?.headers as Record<string, string> || {}),
  };
  return fetch(`${GITHUB_API}${path}`, { ...init, headers });
}

// ── Validate PAT ───────────────────────────────────────────────

/** Quick check — returns true if the token can authenticate. */
export async function validatePat(pat: string): Promise<{ ok: boolean; login?: string; error?: string }> {
  try {
    const res = await ghFetch('/user', pat);
    if (res.status === 200) {
      const json = await res.json() as { login: string };
      return { ok: true, login: json.login };
    }
    if (res.status === 401) {
      return { ok: false, error: 'Token 无效或已过期，请检查 PAT 是否正确。' };
    }
    return { ok: false, error: `GitHub 返回状态 ${res.status}。` };
  } catch {
    return { ok: false, error: '网络请求失败，请检查网络连接。' };
  }
}

// ── Save (upload) ──────────────────────────────────────────────

/**
 * Upload all local data to a GitHub Gist.
 * Creates the Gist on first call, updates it on subsequent calls.
 */
export async function saveToCloud(): Promise<{ ok: boolean; gistId?: string; error?: string }> {
  const pat = loadPat();
  if (!pat) return { ok: false, error: '请先设置 GitHub PAT。' };

  const payload: SyncPayload = {
    version: 1,
    exportedAt: Date.now(),
    data: collectLocalData(),
  };

  const content = JSON.stringify(payload, null, 2);
  const existingId = localStorage.getItem(GIST_ID_KEY);

  try {
    if (existingId) {
      // Try to update the existing Gist
      const res = await ghFetch(`/gists/${existingId}`, pat, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          files: { [GIST_FILENAME]: { content } },
        }),
      });

      if (res.status === 200) {
        const json = await res.json() as GistResponse;
        localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
        return { ok: true, gistId: json.id };
      }

      // If 404, the Gist was deleted — fall through to create
      if (res.status !== 404) {
        const body = await res.text();
        return { ok: false, error: `更新 Gist 失败 (${res.status}): ${body}` };
      }
    }

    // Create a new Gist
    const res = await ghFetch('/gists', pat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        files: { [GIST_FILENAME]: { content } },
        public: false,
      }),
    });

    if (res.status === 201) {
      const json = await res.json() as GistResponse;
      localStorage.setItem(GIST_ID_KEY, json.id);
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      return { ok: true, gistId: json.id };
    }

    const body = await res.text();
    return { ok: false, error: `创建 Gist 失败 (${res.status}): ${body}` };
  } catch (err) {
    return { ok: false, error: `网络错误: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Load (download) ────────────────────────────────────────────

/**
 * Download data from the GitHub Gist and restore into localStorage.
 */
export async function loadFromCloud(): Promise<{ ok: boolean; error?: string; itemCounts?: Record<string, number> }> {
  const pat = loadPat();
  if (!pat) return { ok: false, error: '请先设置 GitHub PAT。' };

  const gistId = localStorage.getItem(GIST_ID_KEY);
  if (!gistId) return { ok: false, error: '未找到云端备份。请先点击"保存到云端"创建备份。' };

  try {
    const res = await ghFetch(`/gists/${gistId}`, pat);

    if (res.status === 404) {
      localStorage.removeItem(GIST_ID_KEY);
      return { ok: false, error: '云端备份已被删除或不可访问。' };
    }

    if (res.status !== 200) {
      const body = await res.text();
      return { ok: false, error: `读取 Gist 失败 (${res.status}): ${body}` };
    }

    const json = await res.json() as GistResponse;
    const file = json.files[GIST_FILENAME];
    if (!file) {
      return { ok: false, error: `Gist 中未找到备份文件 (${GIST_FILENAME})。` };
    }

    const payload = JSON.parse(file.content) as SyncPayload;
    if (payload.version !== 1 || !payload.data) {
      return { ok: false, error: '备份数据格式不兼容。' };
    }

    restoreLocalData(payload.data);
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));

    // Count items for user feedback
    const itemCounts: Record<string, number> = {};
    try {
      const vocab = payload.data['echolearn_vocabulary'];
      if (vocab) itemCounts['词汇'] = (JSON.parse(vocab) as unknown[]).length;
    } catch { /* skip */ }
    try {
      const sentences = payload.data['echolearn_sentences'];
      if (sentences) itemCounts['句子'] = (JSON.parse(sentences) as unknown[]).length;
    } catch { /* skip */ }
    try {
      const sessions = payload.data['echolearn_sessions_list'];
      if (sessions) itemCounts['学习记录'] = (JSON.parse(sessions) as unknown[]).length;
    } catch { /* skip */ }
    try {
      const plan = payload.data['echolearn_daily_plan'];
      if (plan) itemCounts['计划'] = (JSON.parse(plan) as unknown[]).length;
    } catch { /* skip */ }

    return { ok: true, itemCounts };
  } catch (err) {
    return { ok: false, error: `网络错误: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── Delete cloud backup ────────────────────────────────────────

export async function deleteCloudBackup(): Promise<{ ok: boolean; error?: string }> {
  const pat = loadPat();
  if (!pat) return { ok: false, error: '请先设置 GitHub PAT。' };

  const gistId = localStorage.getItem(GIST_ID_KEY);
  if (!gistId) return { ok: false, error: '没有云端备份可删除。' };

  try {
    const res = await ghFetch(`/gists/${gistId}`, pat, { method: 'DELETE' });
    if (res.status === 204 || res.status === 404) {
      localStorage.removeItem(GIST_ID_KEY);
      localStorage.removeItem(LAST_SYNC_KEY);
      return { ok: true };
    }
    const body = await res.text();
    return { ok: false, error: `删除失败 (${res.status}): ${body}` };
  } catch (err) {
    return { ok: false, error: `网络错误: ${err instanceof Error ? err.message : String(err)}` };
  }
}
