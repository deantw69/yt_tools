// YouTube 內部 API（InnerTube）存取。需在 MAIN world 執行才讀得到 ytcfg。
(() => {
  'use strict';
  const ytt = (globalThis.__ytt ??= {});

  const PAGE_SIZE = 100;

  async function api(endpoint, body) {
    const context = globalThis.ytcfg?.get?.('INNERTUBE_CONTEXT');
    if (!context) throw new Error('找不到 INNERTUBE_CONTEXT');
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      // 以未登入身分請求，公開清單不需要 SAPISIDHASH 驗證
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context, ...body }),
    });
    if (!res.ok) throw new Error(`InnerTube ${endpoint} HTTP ${res.status}`);
    return res.json();
  }

  function findAll(node, key, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (key in node) {
      out.push(node[key]);
      return out;
    }
    for (const k in node) findAll(node[k], key, out);
    return out;
  }

  // ---- protobuf / continuation token ----

  const encoder = new TextEncoder();
  const varint = (n) => {
    const out = [];
    while (n > 127) {
      out.push((n & 127) | 128);
      n = Math.floor(n / 128);
    }
    out.push(n);
    return out;
  };
  const pbInt = (field, n) => [...varint(field * 8), ...varint(n)];
  const pbBytes = (field, data) => {
    const b = typeof data === 'string' ? [...encoder.encode(data)] : data;
    return [...varint(field * 8 + 2), ...varint(b.length), ...b];
  };
  const base64 = (bytes) => btoa(String.fromCharCode(...bytes));

  // 未公開格式：播放清單 continuation token，"PT:" 內 field 1 為起始 offset。
  // PT 必須用 URL-safe base64，否則含 + / 的 offset（例如 8045）會回傳空資料
  function playlistToken(playlistId, offset) {
    const pt = 'PT:' + base64(pbInt(1, offset)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const params = encodeURIComponent(base64([...pbInt(1, 1), ...pbBytes(15, pt)]));
    const msg = [...pbBytes(2, 'VL' + playlistId), ...pbBytes(3, params), ...pbBytes(35, playlistId)];
    return encodeURIComponent(base64(pbBytes(80226972, msg)));
  }

  // ---- 解析 ----

  function parseVideos(json) {
    return findAll(json, 'lockupViewModel')
      .filter((v) => v.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && v.contentId)
      .map((v) => {
        const meta = v.metadata?.lockupMetadataViewModel;
        const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [])
          .flatMap((row) => row.metadataParts ?? [])
          .map((p) => p.text?.content)
          .filter(Boolean);
        const metaText = parts.join(' · ');
        return {
          id: v.contentId,
          title: meta?.title?.content ?? '',
          meta: metaText,
          age: ytt.time.parseAgeMonths(metaText),
          duration: findAll(v.contentImage, 'thumbnailBadgeViewModel')[0]?.text ?? '',
        };
      });
  }

  function parseTotal(json) {
    const runs = findAll(json, 'numVideosText')[0]?.runs;
    const text = runs?.[0]?.text?.trim() ?? '';
    // 只接受純數字（含千分位），「1.4萬」這類縮寫不採用
    return /^[\d,.\s]+$/.test(text) ? Number(text.replace(/\D/g, '')) : null;
  }

  // ---- 對外 ----

  async function resolveChannelId(url) {
    const json = await api('navigation/resolve_url', { url });
    const id = findAll(json, 'browseEndpoint').map((e) => e.browseId).find((b) => /^UC[\w-]{22}$/.test(b));
    if (!id) throw new Error('無法取得頻道 ID');
    return id;
  }

  // 取得播放清單第 offset 部起的最多 100 部影片
  async function fetchPlaylistPage(playlistId, offset) {
    const json = offset === 0
      ? await api('browse', { browseId: 'VL' + playlistId })
      : await api('browse', { continuation: playlistToken(playlistId, offset) });
    return { videos: parseVideos(json), total: offset === 0 ? parseTotal(json) : null };
  }

  ytt.innertube = { PAGE_SIZE, api, resolveChannelId, fetchPlaylistPage };
})();
