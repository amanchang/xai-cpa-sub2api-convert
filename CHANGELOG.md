# Changelog

本專案遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-08-09

### Added

- 線上轉換頁面：`docs/` 可透過 GitHub Pages 發佈，在瀏覽器內完成轉換，不上傳任何資料。
- `docs/core.mjs`：CLI 與網頁共用的單一轉換核心。兩者邏輯同步，不可能漂移。
- `--on-invalid skip|abort`：CLI 預設 `abort`（任一筆不合格即中止），網頁預設 `skip`（寬鬆模式）。
- `counts.unrecognized`：統計讀到但無法識別為帳號的節點數。舊版靜默丟棄，新版回報計數。

### Changed

- 核心移植為純函式 ESM，無 `fs` / DOM / network / `process` 依賴。
- CLI 薄殼化：`scripts/convert_xai_auth.mjs` 只處理檔案 IO 與參數，所有轉換邏輯在 `core.mjs`。
- 測試覆蓋 15 個 golden case（15 組輸入 × 對應參數）、錯誤路徑、時間精度、隱私遮罩、原始碼隱私掃描、i18n 完整性。

### Security

- 網頁零對外請求；fflate 內嵌固定版本並驗證 SHA256；轉換分塊執行不凍結 UI。
- 不預覽成功帳號清單、不顯示任何 token 值或片段；失敗記錄的 email 遮罩為 `b****@example.com`。

## [1.0.0] - 2026-08-08

### Added

- 首次公開發布 / Initial public release.
- `scripts/convert_xai_auth.mjs`：xAI / Grok 帳號匯出 → CPA（CLIProxyAPI）與 Sub2API 匯入格式。
- 單一正規化模型（canonical record），來源欄位 → JWT claim → xAI 預設值三層解析。
- `--target cpa|sub2api|both`、`--mode merged|split|both` 四種輸出組合。
- 五種輸入形狀：grokcli-2api admin 匯出（access token 位於 `key`）、原生 `xai-<email>.json`、CPA auth 檔、`sub2api-data` payload、JSON 陣列 / JSONL / 文字匯出。
- 雙向 round-trip：grokcli → CPA → Sub2API，以及 Sub2API → CPA。
- 過濾與去重：依 `account_id`（退回 email）去重、`--limit`、`--skip-expired`、`--exclude-emails`。
- CPA 輸出 `expired` 為不含毫秒的 RFC3339；Sub2API 輸出 `expires_at` 為含毫秒的 RFC3339。
- CPA 輸出附 `manifest.json`（數量、檔案清單、匯入提示）。
- 執行後輸出 JSON 報告（來源筆數、轉換數、各類跳過原因、警告）。
- 說明書：繁體中文（預設）、簡體中文、English。

### Security

- 不複製來源中的 `password` / `sso` / `session_cookies` 到任何輸出。
- 只回報數量、路徑、欄位名，不輸出 token 值。
- 絕不寫入 `--input` 目錄。
- 文件明確標示 refresh token 為單一持有者，並提供 `--exclude-emails` 維持部署互斥。
