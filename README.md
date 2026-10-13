# YT Tools

改善 YouTube 使用體驗的 Chrome 擴充套件（Manifest V3）。

## 功能

### 跳到 N 年前的影片

在頻道的「影片」或「直播」分頁（`/@handle/videos`、`/@handle/streams`、`/channel/…/videos` 等）右下角會出現控制面板：

1. 輸入數字，選「年前」或「個月前」。
2. 按「跳轉」或 Enter，面板會列出目標影片前後的影片，目標用紅框標示，點擊即開啟影片。上下按鈕可再載入較新或較舊的影片。
3. 執行中按鈕會變成「停止」，可隨時中斷。

日期依列表上的相對時間（例如「5 年前」）判斷，舊影片精度到「年」。支援繁中、簡中、英文、日文、韓文介面。

#### 運作方式

- **快速模式（預設）**：透過 YouTube 內部 API（InnerTube）讀頻道的上傳播放清單（「影片」用 `UULF`、「直播」用 `UULV`）。自組 continuation token 直接跳到任意 offset，每輪平行探測 8 個位置縮小範圍。14,000 部影片的頻道約 1.5 秒定位。
- **備援模式**：快速模式失敗時（例如 token 格式被 YouTube 改掉），自動改成在原列表連續載入並捲到目標影片。
- **限制**：上傳播放清單只涵蓋最新 20,000 部上傳。超過的頻道（多為新聞台）找不到更早的影片時，面板會出現「改用捲動載入」按鈕。

Token 格式屬於未公開格式：`PT:` 那段必須用 URL-safe base64，細節見 `src/lib/innertube.js`。

## 安裝（開發版）

1. 開啟 `chrome://extensions`。
2. 開啟右上角「開發人員模式」。
3. 按「載入未封裝項目」，選擇本資料夾。
4. 修改程式碼後，在擴充功能頁按重新整理，再重新載入 YouTube 分頁。

## 結構

```
manifest.json
src/
  lib/
    relative-time.js  # 相對時間（「5 年前」）→ 月數，多語系
    innertube.js      # InnerTube API、播放清單 offset token、影片解析
  jump-to-date.js     # 跳到 N 年前：搜尋、結果面板、備援捲動
  jump-to-date.css    # 控制面板樣式（跟隨 YouTube 深色模式）
```

Content scripts 跑在 `MAIN` world（需 Chrome 111+），才讀得到頁面的 `ytcfg`。模組之間透過 `globalThis.__ytt` 共用。YouTube 有 Trusted Types 限制，建 DOM 一律用 `createElement`，不用 `innerHTML`。

新功能以 `src/<feature>.js` / `.css` 為單位新增，並登記到 `manifest.json` 的 `content_scripts`。
