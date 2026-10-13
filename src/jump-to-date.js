// 頻道影片列表：跳到「N 年前／N 個月前」的影片。
// 快速模式：自組播放清單 offset token，二分搜尋定位，結果列在面板。
// 備援模式：快速模式失敗時，在原列表自動連續載入並捲到該位置。
(() => {
  'use strict';
  const { time, innertube: it } = globalThis.__ytt;

  const PANEL_ID = 'ytt-jump-panel';
  const HIT_CLASS = 'ytt-jump-hit';
  const CHANNEL_LIST_RE = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(videos|streams)\/?$/;
  const PAGE = it.PAGE_SIZE;
  const PROBES = 8; // 每輪平行探測的 offset 數
  const MAX_ROUNDS = 12;
  const CONTEXT_BEFORE = 10; // 結果列表在目標影片之前多列幾部
  const UPLOADS_CAP = 20000;
  const LOAD_TIMEOUT_MS = 8000;
  const MAX_TIMEOUTS = 4;

  let running = false;
  let cancelled = false;
  let els = null;
  let results = null; // { playlistId, start, videos, targetId, olderDone }
  let lastTarget = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- 快速模式 ----

  async function fastSearch(targetMonths) {
    const tab = location.pathname.match(CHANNEL_LIST_RE)[2];
    const channelUrl = location.origin + location.pathname.replace(/\/(videos|streams)\/?$/, '');
    const channelId = await it.resolveChannelId(channelUrl);
    const playlistId = (tab === 'streams' ? 'UULV' : 'UULF') + channelId.slice(2);

    const cache = new Map();
    let total = null;
    const load = async (offset) => {
      if (!cache.has(offset)) {
        const page = await it.fetchPlaylistPage(playlistId, offset);
        if (offset === 0) total = page.total;
        cache.set(offset, page.videos);
      }
      return cache.get(offset);
    };

    const first = await load(0);
    if (!first.length) throw new Error('播放清單沒有資料');

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
      if (cancelled) return null;
      if (++rounds > MAX_ROUNDS) throw new Error('搜尋未收斂');
      setStatus(`搜尋中… 範圍第 ${lo + 1}–${Math.min(hi, total ?? hi)} 部`);
      const step = (hi - lo) / (PROBES + 1);
      const offsets = [...new Set(Array.from({ length: PROBES }, (_, k) => Math.floor(lo + step * (k + 1))))];
      const pages = await Promise.all(offsets.map(load));
      offsets.forEach((o, i) => check(o, pages[i]));
    }
    if (cancelled) return null;

    let base = lo;
    let page = await load(base);
    if (!page.length && base > 0) {
      base = Math.max(0, lo - PAGE);
      page = await load(base);
    }
    const j = page.findIndex((v) => v.age != null && v.age >= targetMonths);
    if (j >= 0) return { playlistId, index: base + j, video: page[j], found: true, capped: false, load };
    // 上傳播放清單只涵蓋最新 20,000 部，超過的頻道更早的影片只在原列表裡
    const uploads = await it.fetchPlaylistPage('UU' + channelId.slice(2), 0);
    const capped = (uploads.total ?? 0) >= UPLOADS_CAP;
    return { playlistId, index: base + page.length - 1, video: page[page.length - 1], found: false, capped, load };
  }

  async function showResults(r) {
    const start = Math.max(0, r.index - CONTEXT_BEFORE);
    const videos = await r.load(start);
    results = { playlistId: r.playlistId, start, videos, targetId: r.video.id, olderDone: false };
    renderResults();
    const target = els.list.querySelector('.ytt-target');
    if (target) els.list.scrollTop = target.offsetTop - els.list.clientHeight / 2 + target.offsetHeight / 2;
  }

  async function loadOlder() {
    if (!results || results.olderDone) return;
    const videos = (await it.fetchPlaylistPage(results.playlistId, results.start + results.videos.length)).videos;
    if (!videos.length) results.olderDone = true;
    results.videos.push(...videos);
    renderResults();
  }

  async function loadNewer() {
    if (!results || results.start === 0) return;
    const newStart = Math.max(0, results.start - PAGE);
    const videos = (await it.fetchPlaylistPage(results.playlistId, newStart)).videos.slice(0, results.start - newStart);
    const prevHeight = els.list.scrollHeight;
    results.start = newStart;
    results.videos.unshift(...videos);
    renderResults();
    els.list.scrollTop += els.list.scrollHeight - prevHeight;
  }

  // ---- 備援模式：在原列表連續載入 ----

  const getGrid = () => [...document.querySelectorAll('ytd-rich-grid-renderer')].find((g) => g.offsetParent !== null) || null;
  const getItems = (grid) => grid.querySelectorAll('ytd-rich-item-renderer');

  function getItemAge(item) {
    const meta = item.querySelector('#metadata-line, yt-content-metadata-view-model, [class*="ContentMetadata"], [class*="content-metadata"]');
    return time.parseAgeMonths((meta || item).textContent);
  }

  // 等新影片出現；continuation 消失超過 1 秒才視為到底
  async function waitForMore(grid, prevCount) {
    const start = performance.now();
    let missingSince = null;
    while (!cancelled) {
      if (getItems(grid).length > prevCount) return 'more';
      if (!grid.querySelector('ytd-continuation-item-renderer')) {
        missingSince ??= performance.now();
        if (performance.now() - missingSince > 1000) return 'end';
      } else {
        missingSince = null;
      }
      if (performance.now() - start > LOAD_TIMEOUT_MS) return 'timeout';
      await sleep(150);
    }
    return 'cancel';
  }

  function highlight(item) {
    document.querySelectorAll(`.${HIT_CLASS}`).forEach((el) => el.classList.remove(HIT_CLASS));
    item.classList.add(HIT_CLASS);
    item.scrollIntoView({ block: 'center' });
    setTimeout(() => item.classList.remove(HIT_CLASS), 4000);
  }

  async function scrollSearch(targetMonths) {
    let checked = 0;
    let lastAge = null;
    let timeouts = 0;

    while (!cancelled) {
      const grid = getGrid();
      if (!grid) {
        setStatus('找不到影片列表');
        return;
      }
      const items = getItems(grid);
      for (; checked < items.length; checked++) {
        const age = getItemAge(items[checked]);
        if (age == null) continue;
        lastAge = age;
        if (age >= targetMonths) {
          highlight(items[checked]);
          setStatus(`找到第 ${checked + 1} 部：${time.formatAge(age)}`);
          return;
        }
      }

      setStatus(`捲動載入中… 已掃描 ${items.length} 部，目前到 ${time.formatAge(lastAge)}`);

      const cont = grid.querySelector('ytd-continuation-item-renderer');
      if (!cont) {
        if (items.length) items[items.length - 1].scrollIntoView({ block: 'center' });
        setStatus(`已到最舊影片（${time.formatAge(lastAge)}），沒有更早的影片`);
        return;
      }
      cont.scrollIntoView({ block: 'end' });

      const result = await waitForMore(grid, items.length);
      if (result === 'timeout') {
        if (++timeouts >= MAX_TIMEOUTS) {
          setStatus('載入逾時，請稍後再試');
          return;
        }
        // 把 continuation 移出再移回視窗，重新觸發載入
        window.scrollBy(0, -window.innerHeight);
        await sleep(300);
      } else {
        timeouts = 0;
      }
    }
  }

  // ---- 主流程 ----

  async function jump(targetMonths, { scrollOnly = false } = {}) {
    running = true;
    cancelled = false;
    lastTarget = targetMonths;
    results = null;
    renderResults();
    els.fallback.hidden = true;
    setRunning(true);
    const t0 = performance.now();

    try {
      if (scrollOnly) {
        await scrollSearch(targetMonths);
        return;
      }
      let r = null;
      try {
        r = await fastSearch(targetMonths);
      } catch (err) {
        if (cancelled) return;
        console.warn('[YT Tools] 快速模式失敗，改用捲動載入', err);
        setStatus('快速模式失敗，改用捲動載入…');
        await scrollSearch(targetMonths);
        return;
      }
      if (!r || cancelled) return;
      await showResults(r);
      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      if (r.found) {
        setStatus(`第 ${r.index + 1} 部：${time.formatAge(r.video.age)}（${sec} 秒）`);
      } else if (r.capped) {
        setStatus(`快速模式只涵蓋最新 ${UPLOADS_CAP.toLocaleString()} 部上傳，最舊到 ${time.formatAge(r.video.age)}；更早的影片要用捲動載入`);
        els.fallback.hidden = false;
      } else {
        setStatus(`沒有這麼舊的影片，最舊是第 ${r.index + 1} 部：${time.formatAge(r.video.age)}`);
      }
    } catch (err) {
      console.warn('[YT Tools]', err);
      setStatus(`發生錯誤：${err.message}`);
    } finally {
      if (cancelled) setStatus('已停止');
      running = false;
      setRunning(false);
    }
  }

  // ---- UI ----

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) el.append(c);
    return el;
  }

  function buildPanel() {
    const num = h('input', { class: 'ytt-num', type: 'number', min: '1', max: '30', value: '5' });
    const unit = h('select', { class: 'ytt-unit' },
      h('option', { value: '12', selected: '' }, '年前'),
      h('option', { value: '1' }, '個月前'));
    const go = h('button', { class: 'ytt-go' }, '跳轉');
    const status = h('div', { class: 'ytt-status' });
    const fallback = h('button', {
      class: 'ytt-more ytt-fallback',
      hidden: '',
      onclick: () => !running && lastTarget != null && jump(lastTarget, { scrollOnly: true }),
    }, '改用捲動載入（較慢）');
    const newer = h('button', { class: 'ytt-more', onclick: () => withBusy(newer, loadNewer) }, '↑ 載入較新');
    const older = h('button', { class: 'ytt-more', onclick: () => withBusy(older, loadOlder) }, '↓ 載入較舊');
    const list = h('ol', { class: 'ytt-list' });
    const resultsBox = h('div', { class: 'ytt-results', hidden: '' }, newer, list, older);

    const panel = h('div', { id: PANEL_ID },
      h('button', { class: 'ytt-toggle', title: '跳到很久以前的影片', onclick: () => panel.classList.remove('ytt-collapsed') }, '⏪'),
      h('div', { class: 'ytt-body' },
        h('div', { class: 'ytt-row' },
          h('span', {}, '跳到'), num, unit, go,
          h('button', { class: 'ytt-close', title: '收合', onclick: () => panel.classList.add('ytt-collapsed') }, '×')),
        status,
        fallback,
        resultsBox));

    els = { panel, num, unit, go, status, fallback, list, newer, older, resultsBox };

    const start = () => {
      if (running) {
        cancelled = true;
        return;
      }
      const n = Number(num.value);
      if (!(n > 0)) {
        setStatus('請輸入大於 0 的數字');
        return;
      }
      jump(n * Number(unit.value));
    };

    go.addEventListener('click', start);
    num.addEventListener('keydown', (e) => {
      // 避免觸發 YouTube 快捷鍵
      e.stopPropagation();
      if (e.key === 'Enter') start();
    });

    document.body.appendChild(panel);
  }

  async function withBusy(button, fn) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await fn();
    } catch (err) {
      console.warn('[YT Tools]', err);
      setStatus(`載入失敗：${err.message}`);
    } finally {
      button.disabled = false;
      renderResults();
    }
  }

  function renderResults() {
    if (!els) return;
    els.resultsBox.hidden = !results;
    els.panel.classList.toggle('ytt-has-results', !!results);
    if (!results) {
      els.list.replaceChildren();
      return;
    }
    els.newer.hidden = results.start === 0;
    els.older.textContent = results.olderDone ? '已到最舊影片' : '↓ 載入較舊';
    els.older.disabled = results.olderDone;
    els.list.replaceChildren(...results.videos.map((v, i) => h('li', { class: v.id === results.targetId ? 'ytt-target' : '' },
      h('a', { class: 'ytt-video', href: `/watch?v=${v.id}` },
        h('div', { class: 'ytt-thumb' },
          h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
          v.duration ? h('span', { class: 'ytt-duration' }, v.duration) : null),
        h('div', { class: 'ytt-info' },
          h('div', { class: 'ytt-title', title: v.title }, v.title),
          h('div', { class: 'ytt-meta' }, `#${results.start + i + 1} · ${v.meta}`))))));
  }

  function setStatus(text) {
    if (els) els.status.textContent = text;
  }

  function setRunning(on) {
    if (!els) return;
    els.go.textContent = on ? '停止' : '跳轉';
    els.panel.classList.toggle('ytt-running', on);
  }

  function update() {
    cancelled = true;
    results = null;
    if (!CHANNEL_LIST_RE.test(location.pathname)) {
      if (els) els.panel.hidden = true;
      return;
    }
    if (!els) buildPanel();
    els.panel.hidden = false;
    els.fallback.hidden = true;
    renderResults();
    if (!running) setStatus('');
  }

  document.addEventListener('yt-navigate-start', () => {
    cancelled = true;
  });
  document.addEventListener('yt-navigate-finish', update);
  update();
})();
