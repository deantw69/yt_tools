// 頻道 Shorts 分頁：在每部 Short 的觀看次數下方加上上傳日期。
(() => {
  'use strict';
  const { innertube: it, time } = globalThis.__ytt;

  const SHORTS_TAB_RE = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/shorts\/?$/;
  const DATE_CLASS = 'ytt-shorts-date';
  const SUBHEAD_SEL = '.shortsLockupViewModelHostOutsideMetadataSubhead';
  const CONCURRENCY = 6;

  const cache = new Map(); // videoId → Promise<日期字串 | null>
  const queue = [];
  let active = 0;
  let observer = null;
  let scanQueued = false;

  // Shorts 列表沒有日期，逐部向 player 端點查發布時間
  function fetchDate(videoId) {
    if (!cache.has(videoId)) {
      cache.set(videoId, new Promise((resolve) => {
        queue.push({ videoId, resolve });
        pump();
      }));
    }
    return cache.get(videoId);
  }

  async function lookupDate(videoId) {
    const pr = await it.api('player', { videoId });
    const mf = pr.microformat?.playerMicroformatRenderer;
    const date = time.formatDate(mf?.publishDate || mf?.uploadDate);
    if (date) return date;
    // 部分影片未登入時 player 只回「請登入」，改從 next 的 dateText（「2026年11月15日」）取
    const text = it.findAll(await it.api('next', { videoId }), 'dateText')[0]?.simpleText;
    const m = text && /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(text);
    return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : text || null;
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const { videoId, resolve } = queue.shift();
      active++;
      lookupDate(videoId)
        .then(resolve)
        .catch((err) => {
          console.warn('[YT Tools] 取不到 Short 上傳日期', videoId, err);
          resolve(null);
        })
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  const itemVideoId = (item) =>
    item.querySelector('a.reel-item-endpoint')?.getAttribute('href')?.match(/\/shorts\/([\w-]{11})/)?.[1] ?? null;

  async function decorate(item) {
    const videoId = itemVideoId(item);
    const subhead = item.querySelector(SUBHEAD_SEL);
    if (!videoId || !subhead) return;
    let el = item.querySelector(`.${DATE_CLASS}`);
    if (el?.dataset.videoId === videoId) return;
    // 項目被回收給別部影片時，先拿掉舊日期
    el?.remove();
    const date = await fetchDate(videoId);
    if (!date || itemVideoId(item) !== videoId || !subhead.isConnected) return;
    el = item.querySelector(`.${DATE_CLASS}`);
    if (el?.dataset.videoId === videoId) return;
    el?.remove();
    // 沿用觀看次數那行的樣式
    el = document.createElement('div');
    el.className = `${subhead.className} ${DATE_CLASS}`;
    el.dataset.videoId = videoId;
    el.textContent = date;
    subhead.after(el);
  }

  function scan() {
    scanQueued = false;
    for (const grid of document.querySelectorAll('ytd-rich-grid-renderer')) {
      if (grid.offsetParent === null) continue;
      for (const item of grid.querySelectorAll('ytd-rich-item-renderer')) decorate(item);
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(scan, 200);
  }

  function update() {
    observer?.disconnect();
    observer = null;
    if (!SHORTS_TAB_RE.test(location.pathname)) return;
    const root = document.querySelector('ytd-page-manager') ?? document.body;
    // 捲動載入更多、或 YouTube 重繪項目時再補上日期
    observer = new MutationObserver(queueScan);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    queueScan();
  }

  document.addEventListener('yt-navigate-finish', update);
  update();
})();
