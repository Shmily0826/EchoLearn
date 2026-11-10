// This script runs in two offline WebViews before the hosted app starts.
// Keep these keys aligned with src/utils/storage.ts and src/services/localAudio.ts.
const keys = {
  vocabulary: 'echolearn_vocabulary',
  sentences: 'echolearn_sentences',
  sessions: 'echolearn_sessions_list',
  current: 'echolearn_session',
  plan: 'echolearn_daily_plan',
  completed: 'echolearn_completed_videos',
};
const preferences = ['echolearn_lang', 'echolearn-lang-chosen', 'echolearn-tour-completed-v1', 'echolearn_guest_mode'];
const collections = [keys.vocabulary, keys.sentences, keys.sessions];
// Keep the checkpoint out of the app's echolearn_* reset. A reset must not
// re-import an account's old-origin records.
const completed = 'androidStudyOriginMigrationV1';
const mediaDb = 'echolearn-local-media-v2';
const chunkSize = 256 * 1024;
const textChunkSize = 64 * 1024;

function openDb(name, createMedia = false) {
  return new Promise((resolve, reject) => {
    let absent = false;
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      if (createMedia) request.result.createObjectStore('media', { keyPath: 'id' });
      else {
        absent = true;
        request.transaction.abort();
      }
    };
    request.onerror = () => absent ? resolve(null) : reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function useStore(name, store, action, write = false) {
  const db = await openDb(name, write);
  if (!db) return undefined;
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, write ? 'readwrite' : 'readonly');
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function owner() {
  const authPrefix = 'firebase:authUser:';
  const uids = new Set();
  const records = await useStore('firebaseLocalStorageDb', 'firebaseLocalStorage', store => store.getAll());
  for (const row of records ?? []) {
    if (row.fbase_key?.startsWith(authPrefix) && row.value?.uid) uids.add(row.value.uid);
  }
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(authPrefix)) {
      const user = JSON.parse(localStorage.getItem(key));
      if (user?.uid) uids.add(user.uid);
    }
  }
  if (uids.size > 1) throw new Error('Ambiguous account');
  return uids.values().next().value ?? null;
}

async function snapshot() {
  const data = {};
  const allowed = [...Object.values(keys), ...preferences, ...collections.map(key => key + '_tombstones')];
  for (const key of allowed) {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return { data, owner: await owner() };
}

function liveAt(item) {
  return item.updatedAt ?? item.addedAt ?? item.createdAt ?? 0;
}

function itemsById(items, current) {
  const byId = new Map(items.map(item => [item.id, item]));
  if (current?.id && (!byId.has(current.id) || liveAt(current) >= liveAt(byId.get(current.id)))) {
    byId.set(current.id, current);
  }
  return byId;
}

function mergeItems(oldItems, newItems, oldDeleted = {}, newDeleted = {}, sessions = false) {
  const items = [];
  const tombstones = Object.create(null);
  const ids = new Set([...newItems.keys(), ...oldItems.keys(), ...Object.keys(oldDeleted), ...Object.keys(newDeleted)]);
  for (const id of ids) {
    const previous = oldItems.get(id);
    const current = newItems.get(id);
    const winner = !current || (previous && liveAt(previous) > liveAt(current)) ? previous : current;
    const deleted = Math.max(Object.hasOwn(oldDeleted, id) ? oldDeleted[id] : 0, Object.hasOwn(newDeleted, id) ? newDeleted[id] : 0);
    if (deleted > 0 && (!winner || deleted >= liveAt(winner))) {
      tombstones[id] = deleted;
    } else if (winner) {
      // A synced copy of the same lesson can have newer metadata but no transcript.
      const other = winner === current ? previous : current;
      if (sessions && other) {
        items.push({
          ...winner,
          transcriptLines: winner.transcriptLines?.length ? winner.transcriptLines : other.transcriptLines,
          transcriptData: winner.transcriptData ?? other.transcriptData,
          transcriptMeta: winner.transcriptMeta ?? other.transcriptMeta,
          aiAnalysis: winner.aiAnalysis ?? other.aiAnalysis,
        });
      } else items.push(winner);
    }
  }
  return { items, tombstones };
}

function planWrites(oldData, newData) {
  const read = (data, key, fallback) => data[key] === undefined ? fallback : JSON.parse(data[key]);
  const oldCurrent = read(oldData, keys.current, null);
  const newCurrent = read(newData, keys.current, null);
  const writes = new Map();
  for (const key of [...collections, keys.plan]) {
    const sessions = key === keys.sessions;
    const deletedKey = key + '_tombstones';
    const result = mergeItems(
      itemsById(read(oldData, key, []), sessions ? oldCurrent : null),
      itemsById(read(newData, key, []), sessions ? newCurrent : null),
      read(oldData, deletedKey, {}),
      read(newData, deletedKey, {}),
      sessions,
    );
    if (oldData[key] !== undefined || oldData[deletedKey] !== undefined || (sessions && oldCurrent)) {
      writes.set(key, JSON.stringify(result.items));
      if (key !== keys.plan) writes.set(deletedKey, JSON.stringify(result.tombstones));
    }
    if (sessions) {
      const current = result.items.find(item => item.id === newCurrent?.id);
      const previous = result.items.find(item => item.id === oldCurrent?.id);
      if (current) writes.set(keys.current, JSON.stringify(current));
      else if (previous) {
        // The old active lesson's playback position can be newer than its sync timestamp.
        const restored = previous.youtubeId === oldCurrent.youtubeId && previous.localMediaId === oldCurrent.localMediaId
          ? { ...previous, lastPosition: oldCurrent.lastPosition ?? previous.lastPosition }
          : previous;
        writes.set(keys.current, JSON.stringify(restored));
      } else if (newCurrent) writes.set(keys.current, null);
    }
  }
  if (oldData[keys.completed] !== undefined) {
    writes.set(keys.completed, JSON.stringify([...new Set([
      ...read(newData, keys.completed, []), ...read(oldData, keys.completed, []),
    ])]));
  }
  for (const key of preferences) {
    if (newData[key] === undefined && oldData[key] !== undefined) writes.set(key, oldData[key]);
  }
  return writes;
}

let activeMedia;
let serializedSnapshot;
const sourceMethods = {
  async snapshot() {
    const previous = await snapshot();
    serializedSnapshot = JSON.stringify(previous);
    return serializedSnapshot.length;
  },
  snapshotChunk(offset) {
    return serializedSnapshot.slice(offset, offset + textChunkSize);
  },
  async mediaInfo(id) {
    activeMedia = await useStore(mediaDb, 'media', store => store.get(id));
    if (!activeMedia?.blob) return null;
    const { name, type, blob } = activeMedia;
    return { name, type, size: blob.size };
  },
  async mediaChunk(offset) {
    const blob = activeMedia.blob.slice(offset, offset + chunkSize);
    const data = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < data.length; index += 8192) {
      binary += String.fromCharCode(...data.subarray(index, index + 8192));
    }
    return btoa(binary);
  },
};

let sequence = 0;
let pending;
function request(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    pending = { id, resolve, reject };
    MigrationChannel.request(id, method, JSON.stringify(args));
  });
}

async function copyMedia(writes) {
  const sessions = JSON.parse(writes.get(keys.sessions) ?? '[]');
  const ids = new Set(sessions.map(session => session.localMediaId).filter(Boolean));
  for (const id of ids) {
    if (await useStore(mediaDb, 'media', store => store.getKey(id)) !== undefined) continue;
    const info = await request('mediaInfo', id);
    if (!info) continue;
    const parts = [];
    for (let offset = 0; offset < info.size; offset += chunkSize) {
      const data = atob(await request('mediaChunk', offset));
      if (data.length !== Math.min(chunkSize, info.size - offset)) throw new Error('Incomplete audio chunk');
      parts.push(new Blob([Uint8Array.from(data, char => char.charCodeAt(0))]));
    }
    const blob = new Blob(parts, { type: info.type });
    await useStore(mediaDb, 'media', store => store.add({ id, name: info.name, type: info.type, blob }), true);
  }
}

const Migration = {
  async respond(id, method, args) {
    try {
      const value = await sourceMethods[method](...args);
      MigrationChannel.reply(id, JSON.stringify({ value }));
    } catch {
      MigrationChannel.reply(id, JSON.stringify({ error: true }));
    }
  },
  receive(id, response) {
    if (pending?.id !== id) return;
    const { resolve, reject } = pending;
    pending = undefined;
    const message = JSON.parse(response);
    if (message.error) reject(new Error('Could not read previous storage'));
    else resolve(message.value);
  },
  async run() {
    try {
      if (!localStorage.getItem(completed)) {
        const length = await request('snapshot');
        const chunks = [];
        for (let offset = 0; offset < length; offset += textChunkSize) {
          chunks.push(await request('snapshotChunk', offset));
        }
        const previous = JSON.parse(chunks.join(''));
        if (Object.keys(previous.data).some(key => !preferences.includes(key))) {
          const current = await snapshot();
          if (previous.owner !== current.owner) {
            MigrationChannel.complete('account');
            return;
          }
          const writes = planWrites(previous.data, current.data);
          await copyMedia(writes);
          // Audio is durable before publishing the lesson. Each merge is safe to repeat.
          try {
            for (const [key, value] of writes) {
              if (value === null) localStorage.removeItem(key);
              else localStorage.setItem(key, value);
            }
            localStorage.setItem(completed, '1');
          } catch (error) {
            for (const key of writes.keys()) {
              if (current.data[key] === undefined) localStorage.removeItem(key);
              else localStorage.setItem(key, current.data[key]);
            }
            throw error;
          }
        } else localStorage.setItem(completed, '1');
      }
      MigrationChannel.complete('complete');
    } catch {
      MigrationChannel.complete('retry');
    }
  },
};
