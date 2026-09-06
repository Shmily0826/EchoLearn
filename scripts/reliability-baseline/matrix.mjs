/**
 * Frozen video matrix for the Caption Reliability Baseline V1 window.
 * Spec: docs/RELIABILITY_BASELINE_V1.md
 *
 * All 12 IDs are native-caption positives independently confirmed by
 * YouTube-origin capture in external sanitized manifests:
 *   D:/CODE/API/echolearn/evidence/ECHO-20260904-2235-native/ (5 IDs)
 *   D:/CODE/API/echolearn/evidence/ECHO-20260904-2325-native/ (7 IDs)
 * Do not add, remove, or reorder entries silently; a replacement requires a
 * fresh YouTube-origin-confirmed positive and a recorded note.
 */

export const BASELINE_MATRIX = [
  { videoId: 'ZbZSe6N_BXs', note: 'Happy; known production-positive via Supadata 2026-09-05', manifest: 'ECHO-20260904-2325-native' },
  { videoId: 'JGwWNGJdvx8', note: 'Shape of You; Supadata worst case ~14.4s; production-negative pre-Supadata', manifest: 'ECHO-20260904-2325-native' },
  { videoId: 'RgKAFK5djSk', note: '', manifest: 'ECHO-20260904-2325-native' },
  { videoId: 'CevxZvSJLk8', note: '', manifest: 'ECHO-20260904-2325-native' },
  { videoId: '60ItHLz5WEA', note: 'auto-caption only at capture', manifest: 'ECHO-20260904-2325-native' },
  { videoId: '3JZ_D3ELwOQ', note: '', manifest: 'ECHO-20260904-2325-native' },
  { videoId: 'L_jWHffIx5E', note: '', manifest: 'ECHO-20260904-2325-native' },
  { videoId: 'arj7oStGLkU', note: 'TED talk; manual+auto', manifest: 'ECHO-20260904-2235-native' },
  { videoId: 'Ks-_Mh1QhMc', note: 'TED talk; manual+auto', manifest: 'ECHO-20260904-2235-native' },
  { videoId: 'e-ORhEE9VVg', note: 'TED talk', manifest: 'ECHO-20260904-2235-native' },
  { videoId: 'YQHsXMglC9A', note: '', manifest: 'ECHO-20260904-2235-native' },
  { videoId: 'OPf0YbXqDm0', note: '', manifest: 'ECHO-20260904-2235-native' },
];
