// 在上傳播放清單裡依相對時間搜尋：平行探測多個 offset 逐輪縮小範圍。
(() => {
  'use strict';
  const ytt = globalThis.__ytt;
  const { innertube: it } = ytt;

  const PAGE = it.PAGE_SIZE;
  const PROBES = 8; // 每輪平行探測的 offset 數
  const MAX_ROUNDS = 12;
  const SCAN_BATCH = 10; // 逐頁找影片 ID 時每批平行抓幾頁
  const MAX_SCAN_BATCHES = 10;

  // 帶快取的分頁載入器；load.total 在載入第 0 頁後才有值
  function createLoader(playlistId) {
    const cache = new Map();
    const load = async (offset) => {
      if (!cache.has(offset)) {
        const page = await it.fetchPlaylistPage(playlistId, offset);
        if (offset === 0) load.total = page.total;
        cache.set(offset, page.videos);
      }
      return cache.get(offset);
    };
    load.playlistId = playlistId;
    load.total = null;
    return load;
  }

  // 找第一部相對時間 >= targetMonths 的影片。
  // 回傳 { index, video, found }；沒有那麼舊的影片時 found=false、index 指向最舊一部；取消時回傳 null。
  async function findFirstAtLeast(load, targetMonths, { onProgress, isCancelled = () => false } = {}) {
    const first = await load(0);
    if (!first.length) throw new Error('播放清單沒有資料');
    const total = load.total;

    // 不變式：index < lo 的影片都比目標新；index >= hi 的影片不存在或已達目標
    let lo = 0;
    let hi = total ? total + PAGE : 100000;
    const check = (offset, videos) => {
      if (!videos.length) {
        // token 若失效，範圍內的 offset 會拿到空資料
        if (total && offset + PAGE < total * 0.9) throw new Error('offset token 回傳空資料');
        hi = Math.min(hi, offset);
        return;
      }
      if (offset > 0 && videos[0].id === first[0].id) throw new Error('offset token 被忽略');
      const ages = videos.map((v) => v.age).filter((a) => a != null);
      if (!ages.length) return;
      if (ages[ages.length - 1] < targetMonths) lo = Math.max(lo, offset + videos.length);
      else if (ages[0] >= targetMonths) hi = Math.min(hi, offset);
      else {
        lo = Math.max(lo, offset);
        hi = Math.min(hi, offset + videos.length);
      }
    };
    check(0, first);

    let rounds = 0;
    while (hi - lo > PAGE) {
      if (isCancelled()) return null;
      if (++rounds > MAX_ROUNDS) throw new Error('搜尋未收斂');
      onProgress?.(lo, Math.min(hi, total ?? hi));
      const step = (hi - lo) / (PROBES + 1);
      const offsets = [...new Set(Array.from({ length: PROBES }, (_, k) => Math.floor(lo + step * (k + 1))))];
      const pages = await Promise.all(offsets.map(load));
      offsets.forEach((o, i) => check(o, pages[i]));
    }
    if (isCancelled()) return null;

    let base = lo;
    let page = await load(base);
    if (!page.length && base > 0) {
      base = Math.max(0, lo - PAGE);
      page = await load(base);
    }
    const j = page.findIndex((v) => v.age != null && v.age >= targetMonths);
    if (j >= 0) return { index: base + j, video: page[j], found: true };
    return { index: base + page.length - 1, video: page[page.length - 1], found: false };
  }

  // 找指定影片在清單中的 index：先用發布時間推算的相對時間縮小範圍，再逐頁比對 ID。
  // 找不到回傳 -1；取消回傳 null。
  async function locateVideo(load, videoId, publishIso, { isCancelled = () => false } = {}) {
    const age = ytt.time.ageFromDate(publishIso);
    if (age == null) throw new Error('無法解析發布時間');
    const unit = ytt.time.ageUnit(age);

    const r = await findFirstAtLeast(load, age - 1e-6, { isCancelled });
    if (!r) return null;
    const start = r.found ? r.index : r.index + 1;

    // dir=+1 從 start 往舊的找；dir=-1 從 start 前一頁往新的找
    const scan = async (dir) => {
      for (let b = 0; b < MAX_SCAN_BATCHES; b++) {
        if (isCancelled()) return null;
        const offsets = Array.from({ length: SCAN_BATCH }, (_, k) =>
          dir > 0 ? start + (b * SCAN_BATCH + k) * PAGE : start - (b * SCAN_BATCH + k + 1) * PAGE)
          .map((o) => Math.max(0, o));
        const pages = await Promise.all([...new Set(offsets)].map(async (o) => [o, await load(o)]));
        for (const [o, videos] of pages) {
          const j = videos.findIndex((v) => v.id === videoId);
          if (j >= 0) return o + j;
        }
        const ages = pages.flatMap(([, videos]) => videos.map((v) => v.age)).filter((a) => a != null);
        if (!ages.length) return -1;
        // 已經整批越過目標所在的刻度就停
        if (dir > 0 && Math.min(...ages) > age + unit) return -1;
        if (dir < 0 && (Math.max(...ages) < age - unit || offsets.includes(0))) return -1;
      }
      return -1;
    };

    const forward = await scan(1);
    if (forward == null || forward >= 0) return forward;
    return start > 0 ? scan(-1) : -1;
  }

  ytt.playlistSearch = { PAGE, createLoader, findFirstAtLeast, locateVideo };
})();
