// 共用 UI：DOM 建構、浮動面板、可上下延伸載入的影片列表。
(() => {
  'use strict';
  const ytt = globalThis.__ytt;

  // YouTube 有 Trusted Types 限制，一律用 createElement 建 DOM
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

  // SVG 要用 createElementNS 建，屬性直接 setAttribute
  function svg(tag, attrs = {}, ...children) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const c of children.flat()) if (c != null) el.append(c);
    return el;
  }

  // 日曆疊放大鏡：代表依日期搜尋
  function dateSearchIcon() {
    return svg('svg', { class: 'ytt-icon', viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true' },
      svg('rect', { x: '2.5', y: '4.5', width: '15', height: '14', rx: '2' }),
      svg('path', { d: 'M2.5 9h15M6.5 2.5v4M13.5 2.5v4' }),
      // 放大鏡底下先蓋一塊背景色，壓掉日曆的線
      svg('circle', { class: 'ytt-icon-cutout', cx: '16', cy: '16', r: '5.5' }),
      svg('circle', { cx: '16', cy: '16', r: '3.5' }),
      svg('path', { d: 'M18.6 18.6l3 3' }));
  }

  // 用 YouTube 自己的 SPA 導覽開影片，不重新載入整頁
  function navigateToVideo(videoId) {
    const url = `/watch?v=${videoId}`;
    const app = document.querySelector('ytd-app');
    if (!app) {
      location.href = url;
      return;
    }
    app.dispatchEvent(new CustomEvent('yt-navigate', {
      bubbles: true,
      composed: true,
      detail: {
        endpoint: {
          commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
          watchEndpoint: { videoId },
        },
      },
    }));
  }

  const MIN_W = 260;
  const MIN_H = 160;
  const MARGIN = 24;

  // 面板固定在右下角，所以從左上角拖曳：往左上拉變大。尺寸依面板 id 記在 localStorage
  function makeResizable(panel, body, grip, storageKey) {
    const clamp = (w, h) => [
      Math.max(MIN_W, Math.min(w, window.innerWidth - MARGIN * 2)),
      Math.max(MIN_H, Math.min(h, window.innerHeight - MARGIN * 2)),
    ];
    const apply = (size) => {
      if (size) {
        const [w, h] = clamp(size.w, size.h);
        body.style.width = `${w}px`;
        body.style.height = `${h}px`;
      } else {
        body.style.width = '';
        body.style.height = '';
      }
      panel.classList.toggle('ytt-sized', !!size);
    };

    try {
      apply(JSON.parse(localStorage.getItem(storageKey) || 'null'));
    } catch {
      // 讀不到就用預設大小
    }

    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const rect = body.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
      let size = null;
      const move = (ev) => {
        size = { w: start.w + (start.x - ev.clientX), h: start.h + (start.y - ev.clientY) };
        apply(size);
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        if (!size) return;
        try {
          localStorage.setItem(storageKey, JSON.stringify(size));
        } catch {
          // 存不了就只在這次有效
        }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });

    grip.addEventListener('dblclick', () => {
      apply(null);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // 忽略
      }
    });
  }

  // 浮動面板外框：收合按鈕、標題列、狀態列、內容區
  function createPanel({ id, icon, title, header = [], onClose }) {
    const status = h('div', { class: 'ytt-status' });
    const content = h('div', { class: 'ytt-content' });
    const grip = h('div', { class: 'ytt-resize', title: '拖曳調整大小，雙擊還原' });
    const panel = h('div', { id, class: 'ytt-panel' },
      h('button', { class: 'ytt-toggle', title, onclick: () => panel.classList.remove('ytt-collapsed') }, icon),
      h('div', { class: 'ytt-body' },
        grip,
        h('div', { class: 'ytt-row' },
          ...header,
          h('button', {
            class: 'ytt-close',
            title: onClose ? '關閉' : '收合',
            onclick: () => (onClose ? onClose() : panel.classList.add('ytt-collapsed')),
          }, '×')),
        status,
        content));
    document.body.appendChild(panel);
    makeResizable(panel, panel.querySelector('.ytt-body'), grip, `ytt-size:${id}`);
    return {
      panel,
      content,
      setStatus: (text) => {
        status.textContent = text;
      },
    };
  }

  // 影片列表：state = { load, start, videos, targetId, olderDone }
  function createVideoList({ onError } = {}) {
    const PAGE = ytt.playlistSearch.PAGE;
    let state = null;

    const newer = h('button', { class: 'ytt-more', onclick: () => withBusy(newer, loadNewer) }, '↑ 載入較新');
    const older = h('button', { class: 'ytt-more', onclick: () => withBusy(older, loadOlder) }, '↓ 載入較舊');
    const list = h('ol', { class: 'ytt-list' });
    const el = h('div', { class: 'ytt-results', hidden: '' }, newer, list, older);

    list.addEventListener('click', (e) => {
      const a = e.target.closest('a.ytt-video');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigateToVideo(a.dataset.id);
    });

    async function withBusy(button, fn) {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await fn();
      } catch (err) {
        console.warn('[YT Tools]', err);
        onError?.(`載入失敗：${err.message}`);
      } finally {
        button.disabled = false;
        render();
      }
    }

    async function loadOlder() {
      if (!state || state.olderDone) return;
      const videos = await state.load(state.start + state.videos.length);
      if (!videos.length) state.olderDone = true;
      state.videos.push(...videos);
    }

    async function loadNewer() {
      if (!state || state.start === 0) return;
      const newStart = Math.max(0, state.start - PAGE);
      const videos = (await state.load(newStart)).slice(0, state.start - newStart);
      const prevHeight = list.scrollHeight;
      state.start = newStart;
      state.videos.unshift(...videos);
      render();
      list.scrollTop += list.scrollHeight - prevHeight;
    }

    function render() {
      el.hidden = !state;
      if (!state) {
        list.replaceChildren();
        return;
      }
      newer.hidden = state.start === 0;
      older.textContent = state.olderDone ? '已到最舊影片' : '↓ 載入較舊';
      older.disabled = state.olderDone;
      list.replaceChildren(...state.videos.map((v, i) => h('li', { class: v.id === state.targetId ? 'ytt-target' : '' },
        h('a', { class: 'ytt-video', href: `/watch?v=${v.id}`, 'data-id': v.id },
          h('div', { class: 'ytt-thumb' },
            h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
            v.duration ? h('span', { class: 'ytt-duration' }, v.duration) : null),
          h('div', { class: 'ytt-info' },
            h('div', { class: 'ytt-title', title: v.title }, v.title),
            h('div', { class: 'ytt-meta' }, `#${state.start + i + 1} · ${v.meta}`))))));
    }

    return {
      el,
      // 以 index 為中心顯示，前面保留 before 部
      async showAround(load, index, targetId, before = 10) {
        const start = Math.max(0, index - before);
        state = { load, start, videos: [...(await load(start))], targetId, olderDone: false };
        render();
        this.scrollToTarget();
      },
      setTarget(id) {
        if (!state) return false;
        state.targetId = id;
        render();
        return state.videos.some((v) => v.id === id);
      },
      scrollToTarget() {
        const target = list.querySelector('.ytt-target');
        if (target) list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.offsetHeight / 2;
      },
      clear() {
        state = null;
        render();
      },
    };
  }

  ytt.ui = { h, dateSearchIcon, navigateToVideo, createPanel, createVideoList };
})();
