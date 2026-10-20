// 頻道影片列表：跳到「N 年前／N 個月前」的影片。
// 快速模式：自組播放清單 offset token，平行探測定位，結果列在面板。
// 備援模式：快速模式失敗時，在原列表自動連續載入並捲到該位置。
(() => {
  'use strict';
  const { time, innertube: it, playlistSearch: search, ui } = globalThis.__ytt;
  const { h } = ui;

  const HIT_CLASS = 'ytt-jump-hit';
  const CHANNEL_LIST_RE = /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(videos|streams)\/?$/;
  const UPLOADS_CAP = 20000; // 上傳播放清單只涵蓋最新 20,000 部
  const LOAD_TIMEOUT_MS = 8000;
  const MAX_TIMEOUTS = 4;

  let running = false;
  let cancelled = false;
  let lastTarget = null;
  let els = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- 快速模式 ----

  async function fastSearch(targetMonths) {
    const tab = location.pathname.match(CHANNEL_LIST_RE)[2];
    const channelUrl = location.origin + location.pathname.replace(/\/(videos|streams)\/?$/, '');
    const channelId = await it.resolveChannelId(channelUrl);
    const load = search.createLoader((tab === 'streams' ? 'UULV' : 'UULF') + channelId.slice(2));

    const r = await search.findFirstAtLeast(load, targetMonths, {
      isCancelled: () => cancelled,
      onProgress: (lo, hi) => setStatus(`搜尋中… 範圍第 ${lo + 1}–${hi} 部`),
    });
    if (!r) return null;
    let capped = false;
    if (!r.found) {
      // 超過上限的頻道，更早的影片只在原列表裡
      const uploads = await it.fetchPlaylistPage('UU' + channelId.slice(2), 0);
      capped = (uploads.total ?? 0) >= UPLOADS_CAP;
    }
    return { ...r, capped, load };
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
    els.list.clear();
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
      await els.list.showAround(r.load, r.index, r.video.id);
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

  function buildPanel() {
    const num = h('input', { class: 'ytt-num', type: 'number', min: '1', max: '30', value: '5' });
    const unit = h('select', { class: 'ytt-unit' },
      h('option', { value: '12', selected: '' }, '年前'),
      h('option', { value: '1' }, '個月前'));
    const go = h('button', { class: 'ytt-go' }, '跳轉');

    const { panel, content, setStatus: set } = ui.createPanel({
      id: 'ytt-jump-panel',
      icon: ui.dateSearchIcon(),
      title: '跳到很久以前的影片',
      header: [h('span', {}, '跳到'), num, unit, go],
    });
    const fallback = h('button', {
      class: 'ytt-more ytt-fallback',
      hidden: '',
      onclick: () => !running && lastTarget != null && jump(lastTarget, { scrollOnly: true }),
    }, '改用捲動載入（較慢）');
    const list = ui.createVideoList({ onError: set });
    content.append(fallback, list.el);

    els = { panel, go, fallback, list, setStatus: set };

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
  }

  function setStatus(text) {
    els?.setStatus(text);
  }

  function setRunning(on) {
    if (!els) return;
    els.go.textContent = on ? '停止' : '跳轉';
    els.panel.classList.toggle('ytt-running', on);
  }

  function update() {
    cancelled = true;
    if (!CHANNEL_LIST_RE.test(location.pathname)) {
      if (els) els.panel.hidden = true;
      return;
    }
    if (!els) buildPanel();
    els.panel.hidden = false;
    // 進入頻道列表時預設收合成按鈕，點開再用
    if (!running) els.panel.classList.add('ytt-collapsed');
    els.fallback.hidden = true;
    els.list.clear();
    if (!running) setStatus('');
  }

  document.addEventListener('yt-navigate-start', () => {
    cancelled = true;
  });
  document.addEventListener('yt-navigate-finish', update);
  update();
})();
