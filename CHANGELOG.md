# Changelog

本專案遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。
This project adheres to [Semantic Versioning](https://semver.org/).

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
