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

  // 浮動面板外框：收合按鈕、標題列、狀態列、內容區
  function createPanel({ id, icon, title, header = [], onClose }) {
    const status = h('div', { class: 'ytt-status' });
    const content = h('div', { class: 'ytt-content' });
    const panel = h('div', { id, class: 'ytt-panel' },
      h('button', { class: 'ytt-toggle', title, onclick: () => panel.classList.remove('ytt-collapsed') }, icon),
      h('div', { class: 'ytt-body' },
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

  ytt.ui = { h, navigateToVideo, createPanel, createVideoList };
})();
