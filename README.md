# YT Tools

改善 YouTube 使用體驗的 Chrome 擴充套件（Manifest V3）。

## 功能

### 跳到 N 年前的影片

在頻道的「影片」或「直播」分頁（`/@handle/videos`、`/@handle/streams`、`/channel/…/videos` 等）右下角會出現日曆＋放大鏡按鈕（預設收合），點開後是控制面板：

1. 輸入數字，選「年前」或「個月前」。
2. 按「跳轉」或 Enter，面板會列出目標影片前後的影片，目標用紅框標示，點擊即開啟影片。上下按鈕可再載入較新或較舊的影片。
3. 執行中按鈕會變成「停止」，可隨時中斷。

日期依列表上的相對時間（例如「5 年前」）判斷，舊影片精度到「年」。支援繁中、簡中、英文、日文、韓文介面。

#### 運作方式

- **快速模式（預設）**：透過 YouTube 內部 API（InnerTube）讀頻道的上傳播放清單（「影片」用 `UULF`、「直播」用 `UULV`）。自組 continuation token 直接跳到任意 offset，每輪平行探測 8 個位置縮小範圍。14,000 部影片的頻道約 1.5 秒定位。
- **備援模式**：快速模式失敗時（例如 token 格式被 YouTube 改掉），自動改成在原列表連續載入並捲到目標影片。
- **限制**：上傳播放清單只涵蓋最新 20,000 部上傳。超過的頻道（多為新聞台）找不到更早的影片時，面板會出現「改用捲動載入」按鈕。

Token 格式屬於未公開格式：`PT:` 那段必須用 URL-safe base64，細節見 `src/lib/innertube.js`。

### 影片頁顯示上傳日期

影片標題下方的資訊列，把「7 年前」這類相對時間換成實際上傳日期，例如 `2009/10/25`。滑鼠移上去仍可看到原本的相對時間。日期取自播放器的 `microformat.publishDate`，依本機時區顯示。

### 同頻道前後影片

日期旁的「⇅ 前後影片」按鈕會開啟面板，列出同頻道在這部影片前後上傳的影片，本片用紅框標示，可上下載入更多。點清單裡的影片會直接換頁，面板保留並把標示移到新影片。

定位方式：用發布日期推算 YouTube 會顯示的相對時間（例如「7 年前」），先在上傳播放清單找到該刻度的起點，再逐頁平行比對影片 ID。一般頻道約 1 秒，BBC News 這種上萬部影片的頻道約 2 秒。先找 `UULF`（直播影片找 `UULV`），找不到再找含 Shorts 的完整清單 `UU`。

### 面板大小

兩個浮動面板都可以拖曳左上角的斜線調整大小，往左上拉變大；雙擊斜線還原預設大小。尺寸依面板分別記在 `localStorage`。

## 安裝（開發版）

1. 開啟 `chrome://extensions`。
2. 開啟右上角「開發人員模式」。
3. 按「載入未封裝項目」，選擇本資料夾。
4. 修改程式碼後，在擴充功能頁按重新整理，再重新載入 YouTube 分頁。

## 結構

```
manifest.json
icons/                  # 擴充套件圖示：icon.svg 為原始檔，PNG 由它輸出 16/32/48/128
src/
  lib/
    relative-time.js    # 相對時間（「5 年前」）↔ 月數，多語系
    innertube.js        # InnerTube API、播放清單 offset token、影片解析
    playlist-search.js  # 依相對時間搜尋、依影片 ID 定位
    ui.js / ui.css      # 共用浮動面板、影片列表、SPA 導覽（跟隨 YouTube 深色模式）
  jump-to-date.js/.css  # 頻道頁：跳到 N 年前、備援捲動
  neighbors.js          # 影片頁：同頻道前後影片面板
  upload-date.js/.css   # 影片頁：相對時間換成上傳日期、「前後影片」按鈕
```

Content scripts 跑在 `MAIN` world（需 Chrome 111+），才讀得到頁面的 `ytcfg`。模組之間透過 `globalThis.__ytt` 共用。YouTube 有 Trusted Types 限制，建 DOM 一律用 `createElement`，不用 `innerHTML`。

新功能以 `src/<feature>.js` / `.css` 為單位新增，並登記到 `manifest.json` 的 `content_scripts`。
