// 影片頁：列出同頻道在這部影片前後上傳的影片。
(() => {
  'use strict';
  const ytt = globalThis.__ytt;
  const { playlistSearch: search, ui } = ytt;
  const { h } = ui;

  let els = null;
  let token = 0;

  const currentVideoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

  function getVideoInfo() {
    const videoId = currentVideoId();
    const pr = document.getElementById('movie_player')?.getPlayerResponse?.();
    if (!videoId || pr?.videoDetails?.videoId !== videoId) return null;
    const mf = pr.microformat?.playerMicroformatRenderer;
    const publish = mf?.publishDate || mf?.uploadDate;
    const channelId = pr.videoDetails.channelId;
    if (!publish || !/^UC[\w-]{22}$/.test(channelId ?? '')) return null;
    return { videoId, channelId, publish, isLive: !!pr.videoDetails.isLiveContent };
  }

  function buildPanel() {
    const { panel, content, setStatus } = ui.createPanel({
      id: 'ytt-neighbors-panel',
      icon: '⇅',
      title: '同頻道前後影片',
      header: [h('span', { class: 'ytt-heading' }, '同頻道前後影片')],
      onClose: close,
    });
    const list = ui.createVideoList({ onError: setStatus });
    content.append(list.el);
    els = { panel, list, setStatus };
  }

  function close() {
    token++;
    if (els) els.panel.hidden = true;
  }

  async function open() {
    if (!els) buildPanel();
    els.panel.hidden = false;
    els.panel.classList.remove('ytt-collapsed');
    els.list.clear();

    const info = getVideoInfo();
    if (!info) {
      els.setStatus('影片資料還沒載入完成，請稍後再試');
      return;
    }

    const my = ++token;
    const isCancelled = () => my !== token;
    const t0 = performance.now();
    els.setStatus('定位中…');

    try {
      // 先找同類型清單（一般影片／直播），找不到再用含 Shorts 的完整上傳清單
      const prefixes = info.isLive ? ['UULV', 'UU'] : ['UULF', 'UU'];
      for (const prefix of prefixes) {
        const load = search.createLoader(prefix + info.channelId.slice(2));
        const index = await search.locateVideo(load, info.videoId, info.publish, { isCancelled });
        if (index == null || isCancelled()) return;
        if (index >= 0) {
          await els.list.showAround(load, index, info.videoId);
          const sec = ((performance.now() - t0) / 1000).toFixed(1);
          els.setStatus(`本片是第 ${index + 1} 新的影片（${sec} 秒）`);
          return;
        }
      }
      els.setStatus('上傳清單裡找不到這部影片（可能是不公開影片，或頻道上傳超過 2 萬部）');
    } catch (err) {
      if (isCancelled()) return;
      console.warn('[YT Tools]', err);
      els.setStatus(`發生錯誤：${err.message}`);
    }
  }

  // 換到其他影片後，面板收合成按鈕（列表保留），標示移到新影片
  document.addEventListener('yt-navigate-finish', () => {
    if (!els || els.panel.hidden) return;
    const videoId = currentVideoId();
    if (!videoId) {
      close();
      return;
    }
    els.panel.classList.add('ytt-collapsed');
    if (els.list.setTarget(videoId)) {
      els.list.scrollToTarget();
      els.setStatus('');
    } else {
      els.setStatus('目前影片不在列表中，按日期旁的「前後影片」重新定位');
    }
  });

  ytt.neighbors = { open };
})();
