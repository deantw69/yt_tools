// 解析 YouTube 的相對時間（「5 年前」、「3 months ago」…）成月數。
(() => {
  'use strict';
  const ytt = (globalThis.__ytt ??= {});

  // 相對時間單位 → 月數
  const UNIT_MONTHS = {
    second: 0, minute: 0, hour: 0, day: 1 / 30, week: 7 / 30, month: 1, year: 12,
    '秒': 0, '分鐘': 0, '分钟': 0, '分': 0, '小時': 0, '小时': 0, '時間': 0,
    '天': 1 / 30, '日': 1 / 30, '週間': 7 / 30, '週': 7 / 30, '周': 7 / 30,
    '個月': 1, '个月': 1, 'か月': 1, 'ヶ月': 1, '年': 12,
    '초': 0, '분': 0, '시간': 0, '일': 1 / 30, '주': 7 / 30, '개월': 1, '년': 12,
  };
  const RELATIVE_RES = [
    /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/gi,
    /(\d+)\s*(秒|分鐘|分钟|小時|小时|時間|分|天|日|週間|週|周|個月|个月|か月|ヶ月|年)\s*前/g,
    /(\d+)\s*(초|시간|분|일|주|개월|년)\s*전/g,
  ];

  // 取最後一個符合的相對時間；標題可能也含「N 年前」字樣，發布時間通常在最後
  function parseAgeMonths(text) {
    let last = null;
    let lastIndex = -1;
    for (const re of RELATIVE_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (m.index > lastIndex) {
          lastIndex = m.index;
          last = Number(m[1]) * UNIT_MONTHS[m[2].toLowerCase()];
        }
      }
    }
    return last;
  }

  function formatAge(months) {
    if (months == null) return '—';
    if (months >= 12) return `${Math.floor(months / 12)} 年前`;
    if (months >= 1) return `${Math.round(months)} 個月前`;
    return '不到 1 個月';
  }

  ytt.time = { parseAgeMonths, formatAge };
})();
