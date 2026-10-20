# 待辦

## 上架 Chrome Web Store（等確定要上架再做）

現況：MV3、無遠端程式碼、無混淆、無 `permissions`（只有 youtube.com content script）、不收集資料，沒有會直接被退件的問題。

### 必改（降低被退件風險）

- [ ] 改名：「YT Tools」有冒用 YouTube 商標風險，改成「○○ for YouTube™」形式（`manifest.json` 的 `name`、README）
- [ ] 換圖示：目前紅色圓角方形＋白色圖案太像 YouTube logo，換主色；128px 圖示實際圖案約 96×96、四周留透明邊

### 上架素材

- [ ] 單一用途說明：聚焦「依上傳時間瀏覽頻道影片」（跳到 N 年前、上傳日期、前後影片都屬於這個目的）
- [ ] 商店描述：與實際功能相符，不堆關鍵字
- [ ] 截圖至少 1 張（1280×800 或 640×400），宣傳小圖 440×280（可能已改為選填）
- [ ] 隱私權政策頁（例如 GitHub Pages），內容：不收集任何資料，只用 `localStorage` 記面板大小，請求只送到 YouTube
- [ ] 隱私權分頁：資料使用聲明勾「不收集」、遠端程式碼選「否」、說明 youtube.com 網站存取的用途
- [ ] 打包 zip（排除 `.git`、`icons/icon.svg` 等非必要檔）

### 帳號

- [ ] Google 開發者帳號（一次性費用約 US$5，需開兩步驟驗證）
- [ ] 交易商／非交易商聲明（申報為交易商的話，地址與電話會公開）

### 已知風險（不影響上架）

- 使用 YouTube 內部 API（InnerTube）與自組 offset token：不違反 Chrome 商店政策，但違反 YouTube 使用條款中「未經許可的自動化存取」的精神，YouTube 一改格式功能就會壞
- 送審前到 Chrome Web Store 開發者後台確認最新的費用與素材規格
