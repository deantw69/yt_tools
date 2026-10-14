// 影片頁資訊列：把「7 年前」換成實際上傳日期。
(() => {
  'use strict';

  const DATE_CLASS = 'ytt-upload-date';
  const HIDDEN_CLASS = 'ytt-hidden-date';
  const BUTTON_CLASS = 'ytt-neighbors-btn';
  const RETRY_MS = 300;
  const MAX_TRIES = 40;

  let token = 0;
  let observer = null;

  function currentVideoId() {
    return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
  }

  // 從播放器取得目前影片的發布時間；SPA 換頁後要等播放器換成新影片
  function getPublishDate(videoId) {
    const pr = document.getElementById('movie_player')?.getPlayerResponse?.();
    if (pr?.videoDetails?.videoId !== videoId) return null;
    const mf = pr.microformat?.playerMicroformatRenderer;
    return mf?.publishDate || mf?.uploadDate || null;
  }

  function formatDate(iso) {
    // 只有日期（無時間）時直接用，避免被當成 UTC 而差一天
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  // 資訊列有兩種排版：觀看次數與日期分成 #view-count / #date-text（數字會滾動），
  // 或整串放在 #info 裡（「觀看次數：9.2萬次  6 天前  《播放清單》」），此時 #date-text 是空的
  function findDateAnchor(host) {
    const original = host.querySelector('#date-text');
    if (!original || original.textContent.trim()) return original;
    const parse = globalThis.__ytt.time?.parseAgeMonths;
    return [...host.querySelectorAll('#info > span')].find((s) => parse?.(s.textContent) != null) ?? original;
  }

  function render(dateText) {
    const host = document.querySelector('ytd-watch-metadata ytd-watch-info-text');
    const original = host && findDateAnchor(host);
    if (!original) return false;
    let el = host.querySelector(`.${DATE_CLASS}`);
    if (!el) {
      el = document.createElement('span');
      el.className = DATE_CLASS;
      // 換頁時原本的相對時間會晚一點才更新，hover 時再讀
      el.addEventListener('mouseenter', () => {
        const hidden = host.querySelector(`.${HIDDEN_CLASS}`);
        el.title = (hidden?.getAttribute('aria-label') || hidden?.textContent || '').trim();
      });
    }
    let btn = host.querySelector(`.${BUTTON_CLASS}`);
    if (!btn) {
      btn = document.createElement('button');
      btn.className = BUTTON_CLASS;
      btn.textContent = '⇅ 前後影片';
      btn.title = '列出同頻道在這部影片前後上傳的影片';
      btn.addEventListener('click', (e) => {
        // 避免觸發說明欄展開
        e.stopPropagation();
        e.preventDefault();
        globalThis.__ytt.neighbors?.open();
      });
    }
    // Polymer 可能重排內容，每次都確保緊接在原日期之後
    if (original.nextSibling !== el) original.after(el);
    if (el.nextSibling !== btn) el.after(btn);
    if (el.textContent !== dateText) el.textContent = dateText;
    for (const n of host.querySelectorAll(`.${HIDDEN_CLASS}`)) if (n !== original) n.classList.remove(HIDDEN_CLASS);
    original.classList.add(HIDDEN_CLASS);
    return true;
  }

  // YouTube 載入後可能才切換排版或重繪資訊列，有變動就重新定位
  function watch(dateText) {
    observer?.disconnect();
    const host = document.querySelector('ytd-watch-metadata ytd-watch-info-text');
    if (!host) return;
    let queued = false;
    observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        render(dateText);
      }, 100);
    });
    observer.observe(host, { childList: true, subtree: true, characterData: true });
  }

  function clear() {
    observer?.disconnect();
    observer = null;
    for (const n of document.querySelectorAll(`.${HIDDEN_CLASS}`)) n.classList.remove(HIDDEN_CLASS);
    document.querySelector(`.${DATE_CLASS}`)?.remove();
    document.querySelector(`.${BUTTON_CLASS}`)?.remove();
  }

  async function update() {
    const my = ++token;
    const videoId = currentVideoId();
    if (!videoId) {
      clear();
      return;
    }
    for (let i = 0; i < MAX_TRIES && my === token; i++) {
      const iso = getPublishDate(videoId);
      const text = iso && formatDate(iso);
      if (text && render(text)) {
        watch(text);
        return;
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
    // 取不到日期就保留 YouTube 原本的相對時間
    if (my === token) clear();
  }

  document.addEventListener('yt-navigate-start', () => {
    token++;
    clear();
  });
  document.addEventListener('yt-navigate-finish', update);
  update();
})();
