# xAI → CPA / Sub2API Converter

**繁體中文** ｜ [简体中文](README.zh-CN.md) ｜ [English](README.en.md)

![version](https://img.shields.io/badge/version-1.0.0-blue)
![node](https://img.shields.io/badge/node-18%2B-339933)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-green)

把 **xAI / Grok** 的帳號授權（auth）匯出檔，轉成兩種「實測可以直接匯入」的格式：

1. **CPA（CLIProxyAPI）** 的 xAI OAuth auth 檔
2. **Sub2API** 的匯入 payload（`sub2api-data`）

這是一個 **Codex / Claude 技能包（Skill）**，同時也是一支可以單獨執行的 Node 腳本。**零第三方依賴**，只要有 Node 18 以上就能跑，而且**不會改動你的來源檔案**。

> 📖 **這份 README 是寫給完全的新手看的。**
> 不會假設你懂 OAuth、JWT、RFC3339、遞迴。所有名詞都會先解釋，程式的每一層邏輯也都會用白話講一遍，並附上原始碼片段對照。
> 如果你只想趕快跑起來，直接跳到 [30 秒上手](#30-秒上手)。

---

## 目錄

- [先看這個：這工具到底在做什麼](#先看這個這工具到底在做什麼)
- [名詞先講清楚（新手必讀）](#名詞先講清楚新手必讀)
- [為什麼需要這支工具](#為什麼需要這支工具)
- [不要用錯技能](#不要用錯技能)
- [30 秒上手](#30-秒上手)
- [安裝](#安裝)
- [完整流程圖](#完整流程圖)
- [程式邏輯逐段講解](#程式邏輯逐段講解)
  - [設計構思：為什麼要有「中間格式」](#設計構思為什麼要有中間格式)
  - [第 1 步：把檔案讀進來（讀取層）](#第-1-步把檔案讀進來讀取層)
  - [第 2 步：在任意巢狀裡挖出帳號（辨識層）](#第-2-步在任意巢狀裡挖出帳號辨識層)
  - [第 3 步：湊出十三個欄位（正規化層）](#第-3-步湊出十三個欄位正規化層)
  - [第 4 步：過濾管線（篩選層）](#第-4-步過濾管線篩選層)
  - [第 5 步：長成兩邊要的樣子（渲染層）](#第-5-步長成兩邊要的樣子渲染層)
  - [第 6 步：寫檔與報告（輸出層）](#第-6-步寫檔與報告輸出層)
- [支援的輸入形狀（5 種）](#支援的輸入形狀5-種)
- [四種輸出：兩軸交叉出來的](#四種輸出兩軸交叉出來的)
- [參數說明](#參數說明)
- [輸出目錄結構](#輸出目錄結構)
- [匯入方式](#匯入方式)
- [欄位對應表](#欄位對應表)
- [執行報告怎麼讀](#執行報告怎麼讀)
- [安全護欄](#安全護欄)
- [常見錯誤排查](#常見錯誤排查)
- [驗證清單](#驗證清單)
- [手動整理 vs 用這支腳本](#手動整理-vs-用這支腳本)
- [名詞表](#名詞表)
- [作為 Codex 技能安裝](#作為-codex-技能安裝)
- [版本控制](#版本控制)
- [授權](#授權)

---

## 先看這個：這工具到底在做什麼

用一個生活化的比喻：

> 你有一疊「帳號通行證」，是從一台機器上匯出來的。
> 現在你想把這些通行證改放到另外兩台機器上使用。
>
> 問題是——這三台機器的**登記簿格式完全不一樣**：
>
> - 甲機器把「通行證號碼」寫在 **key** 這一欄
> - 乙機器要求寫在 **access_token** 這一欄，而且時間**不能寫到毫秒**
> - 丙機器也要 **access_token**，但時間**一定要寫到毫秒**，而且要一次交一大本，不能一張一張交
>
> 這支腳本就是那個**看得懂三種登記簿、幫你重抄一遍**的工人。

換成技術語言：

```text
各種 xAI / Grok 帳號匯出檔  ──►  這支腳本  ──►  ① CPA 能吃的 auth 檔（一帳號一檔）
      （5 種形狀）              （統一格式）      ② Sub2API 能吃的 payload（一大包）
```

它**不會**連網、**不會**改你的原始檔、**不會**把 token 印在螢幕上。它只做一件事：**格式轉換**。

**它不做的事，也要先講清楚：**

| 它不會做 | 為什麼 |
|---|---|
| 幫你註冊新帳號 | 它只處理你已經有的匯出檔 |
| 幫你續期 token | 續期是 CPA / Sub2API 匯入後自己去做的 |
| 保證帳號有額度 | 額度是帳號本身的狀態，跟格式無關 |
| 判斷帳號是不是被停用 | CPA 輸出一律寫 `disabled: false`，詳見[欄位對應表](#欄位對應表) |

---

## 名詞先講清楚（新手必讀）

如果你已經懂這些，可以跳過。

### xAI / Grok / grokcli-2api / CPA / Sub2API 分別是什麼

| 名稱 | 白話解釋 | 在本專案的角色 |
|---|---|---|
| **xAI** | Grok 這個 AI 模型背後的公司 | 發放通行證的單位 |
| **Grok** | xAI 的 AI 模型 | 你最後要用的服務 |
| **grokcli-2api** | 一種管理 Grok 帳號的工具，有後台可以匯出帳號 | **來源**（資料從這裡出來） |
| **CPA / CLIProxyAPI** | 一種代理工具，把多個帳號輪流拿去用 | **目的地一** |
| **Sub2API** | 另一種代理工具，功能類似 | **目的地二** |

所以整條路是：

```text
grokcli-2api 匯出  ──►  本腳本  ──►  CPA 或 Sub2API  ──►  你的程式呼叫 Grok
   （來源）            （轉檔）        （目的地）
```

### JSON 是什麼

一種用文字描述資料的格式，長這樣：

```json
{
  "email": "user@example.com",
  "type": "xai"
}
```

大括號 `{}` 包起來的叫「物件」（object），中括號 `[]` 包起來的叫「陣列」（array，就是清單）。

**巢狀（nested）** 就是物件裡面還有物件：

```json
{
  "accounts": [
    { "name": "a@example.com", "credentials": { "access_token": "..." } }
  ]
}
```

這裡 `access_token` 藏在三層裡面：`accounts` → `[0]` → `credentials`。本腳本很大一部分的工作就是**在任意深度的巢狀裡把帳號挖出來**。

### token 是什麼

**token（權杖）** 就是「臨時通行證」。你登入一次，系統發給你一張通行證，之後你拿這張證去用服務，不用每次重新輸入密碼。

這個專案會碰到三種：

| 名稱 | 白話解釋 | 會過期嗎 | 本腳本是否必需 |
|---|---|---|---|
| `access_token` | **門票**。每次呼叫 API 都要出示它 | 會，通常幾小時 | ✅ **必需** |
| `refresh_token` | **換票券**。門票過期時，用它去換一張新門票 | 很久才過期 | ✅ **必需** |
| `id_token` | **身分證**。裡面寫著「你是誰」（email、名字） | 會 | ❌ 可有可無 |

> ⚠️ 這三個都是敏感資訊，等同於你的帳號密碼。**不要貼到公開的地方**（GitHub issue、聊天群、論壇）。

**為什麼 `refresh_token` 是必需的？** 因為 `access_token` 幾小時就過期。如果只給門票不給換票券，帳號匯進去幾小時後就變廢的。所以本腳本的 `isUsable()` 檢查會**強制要求兩者都有**，缺一個就整筆丟掉。

### JWT 是什麼（為什麼腳本能「解出」時間、email、team）

`access_token` 通常是 **JWT** 格式。它其實是三段用點 `.` 隔開的字串：

```text
eyJhbGciOi....  .  eyJzdWIiOiIxMjM0.... .  SflKxwRJSMeKKF2QT4...
   ↑ header            ↑ payload（重點）        ↑ signature 簽章
   說明用什麼演算法      真正的資料在這           防篡改用
```

**中間那段 payload 是 Base64 編碼的 JSON**，也就是說——**任何人都可以直接讀出來，不需要密碼**。

xAI 的 access token payload 裡常見的欄位：

| 欄位 | 意思 | 本腳本拿它做什麼 |
|---|---|---|
| `iat` | issued at，這張票什麼時候發的（Unix 時間戳） | 補 `last_refresh` |
| `exp` | expires，這張票什麼時候過期（Unix 時間戳） | 補 `expires_at` |
| `sub` | subject，使用者的唯一 ID | 補 `principal_id` |
| `principal_id` | xAI 自訂的使用者 ID | 補 `principal_id` |
| `team_id` | 這個帳號屬於哪個 team | 補 `team_id` |
| `client_id` | 是哪個應用程式申請的這張票 | 補 `client_id` |
| `aud` | audience，這張票是給誰用的 | `client_id` 的備援 |
| `scope` | 這張票的權限範圍 | 補 `scope` |
| `email` | 帳號 email | 補 `email` |

**這是本專案最關鍵的設計之一：來源檔案就算什麼都沒寫，只要有 `access_token`，腳本就能自己把上面這些全部挖出來。** 後面 [第 3 步](#第-3-步湊出十三個欄位正規化層) 會詳細講。

> 💡 「Base64 編碼」不是加密。它只是把資料換一種寫法，方便在網路上傳輸，**任何人都能還原**。
> 順帶一提，本腳本用的是 `base64url` 這個變體（把 `+` `/` 換成 `-` `_`），這也是為什麼需要 **Node 18 以上**——舊版 Node 的 `Buffer.from()` 不支援 `"base64url"` 這個參數。

### Unix 時間戳是什麼

一個很大的整數，代表「從 1970 年 1 月 1 日 0 點（UTC）到現在經過幾秒」。

例如 `1786291200` 就是 2026 年某個時刻。

**但有個大坑：有些系統用「秒」，有些用「毫秒」。** 毫秒的數字會大 1000 倍。腳本用一個很簡單的規則判斷：

```js
return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
```

`1e12` 就是 1 兆。**如果數字大於 1 兆，那一定是毫秒**（因為秒數要到西元 33658 年才會破 1 兆），就自動除以 1000 轉回秒。

### RFC3339 是什麼，為什麼毫秒這麼重要

**RFC3339** 是一種寫時間的標準格式，長這樣：

```text
2026-08-08T12:34:56Z          ← 不含毫秒
2026-08-08T12:34:56.789Z      ← 含毫秒（多了 .789）
```

結尾的 `Z` 表示這是 UTC 時間（世界標準時間）。

**這是本專案最容易踩的坑：**

| 目的地 | 要求的格式 | 範例 |
|---|---|---|
| **CPA** | **不含**毫秒 | `2026-08-08T12:34:56Z` |
| **Sub2API** | **含**毫秒 | `2026-08-08T12:34:56.789Z` |

所以腳本裡有**兩個**格式化函式，不是重複程式碼，是刻意的：

```js
/** RFC3339 without milliseconds, matching validated CPA auth files. */
function toIso(epoch) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** RFC3339 with milliseconds, matching validated Sub2API import files. */
function toIsoMs(epoch) {
  if (!epoch) return "";
  return new Date(epoch * 1000).toISOString();
}
```

JavaScript 的 `toISOString()` 本來就會帶毫秒，所以 `toIsoMs()` 直接用；`toIso()` 則用正規表達式把 `.789Z` 換成 `Z` 砍掉毫秒。

> 這兩個格式是**實測比對過可以成功匯入的檔案**得出來的結論，不是猜的。如果你把它們對調，其中一邊的匯入可能會失敗或時間判讀錯誤。

### JSONL 是什麼

**JSON Lines**。就是「一行一個 JSON 物件」的檔案，行與行之間**沒有**逗號、整個檔案**沒有**外層中括號：

```text
{"email":"a@example.com","access_token":"..."}
{"email":"b@example.com","access_token":"..."}
```

好處是可以一行一行讀，不用整個檔案載入記憶體。很多工具匯出大量資料時會用這種格式。

### OAuth 相關名詞

| 名詞 | 白話解釋 |
|---|---|
| **OAuth** | 一套「不給密碼也能授權」的標準流程 |
| **issuer** | 發證機關。本專案固定是 `https://auth.x.ai` |
| **client_id** | 應用程式的身分證號。哪個 App 來要票，就填哪個 |
| **scope** | 這張票的權限清單，例如「可以讀 email」「可以用 grok-cli」 |
| **principal_id** | 使用者本人的唯一 ID |
| **team_id** | 這個帳號屬於哪個團隊（不是每個帳號都有） |
| **account_id** | 本專案組出來的複合 ID，格式是 `<issuer>::<principal_id>` |

**`account_id` 為什麼要這樣組？** 因為同一個 `principal_id` 理論上可能出現在不同的發證機關下。把 issuer 也寫進去，才能保證全世界唯一。CPA 就是用這個格式當帳號的主鍵：

```text
https://auth.x.ai::0552a0b9-953e-43ce-bd11-9eb435cec24a
└──── issuer ────┘└─────────── principal_id ───────────┘
                 ↑ 兩個冒號
```

---

## 為什麼需要這支工具

xAI / Grok 帳號在不同工具之間的存放格式差異很大。以下是**手動改檔一定會踩到**的坑，按嚴重程度排序。

### 坑 1：access token 藏在 `key` 欄位（最容易漏）

grokcli-2api 的 admin 匯出長這樣：

```json
{
  "auth": {
    "https://auth.x.ai::0552a0b9-...": {
      "key": "eyJ0eXAiOiJhdCtqd3Qi...",
      "refresh_token": "mmhF_twJkd03...",
      "email": "user@example.com"
    }
  }
}
```

注意：**access token 在 `key` 這一欄，不是 `access_token`**。

如果你寫程式只去找 `access_token`，會拿到空字串，然後整批帳號都被判定為「不完整」而丟掉。這是本工具最重要的一條相容規則：

```js
const access =
  src.access_token || src.accessToken || src.key || src.token ||
  (src.credentials && src.credentials.access_token) || "";
```

一次試五個位置，哪個有值就用哪個。

### 坑 2：時間格式精度不同

上面 [RFC3339](#rfc3339-是什麼為什麼毫秒這麼重要) 已經講過：CPA 不要毫秒，Sub2API 要毫秒。手動改檔時很容易兩邊寫成一樣，導致其中一邊出問題。

### 坑 3：匯入單位不同

| 目的地 | 匯入單位 | 意思 |
|---|---|---|
| **CPA** | **一帳號一檔** | 200 個帳號要上傳 200 次 |
| **Sub2API** | **一個大 payload** | 200 個帳號放在一個檔案裡，上傳 1 次 |

這兩種需求完全相反，所以本腳本要能**同時產出兩種**。這也是為什麼有 `--mode` 這個參數（詳見[四種輸出](#四種輸出兩軸交叉出來的)）。

### 坑 4：有些欄位只存在 JWT 裡

`scope`、`client_id`、`team_id`、`principal_id` 這幾個欄位，來源檔案常常**根本沒寫**，只藏在 `access_token` 的 JWT payload 裡面。

手動處理的話，你得：

1. 把 token 複製到 Base64 解碼網站
2. 貼上、解碼、看 JSON
3. 找出欄位、抄回你的檔案
4. **重複 200 次**

而且把 token 貼到第三方網站本身就是資安風險。腳本在本機就做完了，不連網。

### 坑 5：CPA 需要特殊 header

CPA 呼叫 xAI 時，必須帶一個自訂的 HTTP header：

```json
"headers": { "X-XAI-Token-Auth": "xai-grok-cli" }
```

少了它，CPA 匯入不會報錯，但**實際呼叫會失敗**。這是最難查的那種錯誤——格式看起來都對，就是不能用。腳本會自動補上。

---

## 不要用錯技能

> ❌ **不要**用 `sub2api-auth-converter` 處理 xAI / Grok 帳號。
>
> 那支工具的目標是 Codex / OpenAI 風格的 auth，它的中間格式裡**沒有** `team_id`、`principal_id`、`X-XAI-Token-Auth`、xAI 的 `base_url` 這些欄位。用它轉出來的檔案，這些欄位會全部消失，匯入 CPA 之後呼叫一定失敗。
>
> ✅ xAI / Grok 請用本專案。

簡單判斷法：

```text
你的帳號是哪一家的？
  │
  ├─ OpenAI / Codex（有 chatgpt_account_id）  ──►  用 sub2api-auth-converter
  │
  └─ xAI / Grok（有 key 或 auth.x.ai）        ──►  用本專案
```

---

## 30 秒上手

### 情境一：我什麼都要，一次全部產出

```bash
node scripts/convert_xai_auth.mjs \
  --input  ./my-grok-export \
  --outdir ./converted \
  --target both \
  --mode   both \
  --label  batch01
```

會在 `./converted/` 底下同時產出 CPA 和 Sub2API 兩種格式、彙總和單帳號兩種模式。**第一次用建議就下這個**，四種都看一眼再決定要哪個。

### 情境二：我只要 CPA，而且要一帳號一檔

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./converted \
  --target cpa --mode split
```

產出 `./converted/cpa/per-account/xai-<email>.json`，這些就是 CPA 實際要上傳的檔案。

### 情境三：我要 Sub2API 批量檔，但要排除已經部署在 CPA 的帳號

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./converted \
  --target sub2api --mode merged \
  --exclude-emails ./already-deployed.txt
```

`already-deployed.txt` 就是一行一個 email 的純文字檔。**這一步非常重要**，原因見[安全護欄](#安全護欄)裡的 refresh token 說明。

### 情境四：我只想先測 3 個帳號

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./test-out \
  --limit 3
```

> **Windows PowerShell 使用者注意**
>
> 1. PowerShell 的換行符號是反引號，不是 `\`。最簡單的做法是**全部寫成一行**
> 2. `node` 沒有的話先去 [nodejs.org](https://nodejs.org/) 裝 LTS 版
> 3. 路徑有空白要用引號包起來

---

## 安裝

需求：**Node 18 或以上**（因為用到 `Buffer.from(..., "base64url")`）。**不需要** `npm install` 任何套件。

### 步驟 1：確認 Node 版本

```bash
node --version
```

要看到 `v18.x.x` 或更高。如果是 `v16` 或更舊，`base64url` 解不出來，JWT 挖不到東西。

### 步驟 2：下載

```bash
git clone https://github.com/amanchang/xai-cpa-sub2api-convert.git
cd xai-cpa-sub2api-convert
```

### 步驟 3：確認能跑

```bash
node scripts/convert_xai_auth.mjs
```

會看到：

```text
Error: --input is required
```

**看到這個錯誤代表安裝成功。** 它在告訴你缺參數，不是壞了。

---
## 完整流程圖

先看整張圖有個印象，下一節會把每一層用白話講一遍。圖上每個方塊都標了對應的「層」名稱。

```text
INPUT  (--input : file or folder)
  +--------------------------------------------------------------------------+
  | 1) grokcli-2api admin export                                             |
  |      { "auth": { "https://auth.x.ai::<uuid>": { key, refresh_token,...}}}|
  |      NOTE: access token lives in "key", not "access_token"               |
  | 2) native grokcli auth file   xai-<email>.json                           |
  | 3) CPA auth file              (round-trips back to Sub2API)              |
  | 4) sub2api-data payload       accounts[].credentials                     |
  | 5) JSON array / JSONL / text export (one JSON object per line)           |
  +---------------------------------+----------------------------------------+
                                    |
                                    v
                    +-----------------------------------+
                    |            loadInput()            |  <-- 讀取層
                    |  folder: *.json *.jsonl *.txt     |
                    |  skips manifest.json / SHA256SUMS |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                    |   extractRecords()   (遞迴掃描)    |  <-- 辨識層
                    |   auth{} / accounts[] /           |
                    |   credentials{} / flat object     |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                    |          canonicalize()           |  <-- 正規化層
                    |                                   |
                    |  resolution precedence:           |
                    |    source field                   |
                    |      -> access_token JWT claim    |
                    |        -> xAI documented default  |
                    |                                   |
                    |  canonical record:                |
                    |    email  access_token            |
                    |    refresh_token  id_token        |
                    |    token_type  scope  client_id   |
                    |    principal_id  team_id          |
                    |    account_id  expires_at         |
                    |    last_refresh                   |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                    |        filter pipeline            |  <-- 篩選層
                    |  isUsable()  -> skipped.incomplete|
                    |  dedupe      -> skipped.duplicate |
                    |  --exclude-emails -> .excluded    |
                    |  --skip-expired   -> .expired     |
                    |  --limit N   -> slice(0, N)       |
                    +--------+---------------+----------+
                             |               |
             --target cpa    |               |    --target sub2api
                             v               v
              <-- 渲染層 -->                <-- 渲染層 -->
        +--------------------------+   +---------------------------+
        |         toCpa()          |   |       toSub2api()         |
        |  type: "xai"             |   |  platform: "grok"         |
        |  auth_kind: "oauth"      |   |  type: "oauth"            |
        |  expired: RFC3339 no ms  |   |  expires_at: RFC3339 + ms |
        |  base_url: cli-chat-...  |   |  base_url: --sub2api-...  |
        |  headers:                |   |  concurrency: 1           |
        |    X-XAI-Token-Auth      |   |  priority: 1              |
        |      = xai-grok-cli      |   |  rate_multiplier: 1       |
        |  disabled: false         |   |  auto_pause_on_expired    |
        +------------+-------------+   +-------------+-------------+
                     |                               |
                     v                               v
   <outdir>/cpa/                            <outdir>/sub2api/
     per-account/xai-<email>.json  <==IMPORT   sub2api-<label>-all-<N>.json <==IMPORT
     manifest.json                            per-account/<email>_sub2api.json
     cpa-xai-merged-<N>.json  (backup only)
                     |                               |
                     v                               v
   POST /v0/management/auth-files            Sub2API admin import
   multipart file=@xai-<email>.json          accepts sub2api-data object
   (or drop into container auths/)
                     |
                     v
             +---------------------------------------------+
             |  stdout: JSON report          <-- 輸出層     |
             |    source_records_seen / accounts_converted |
             |    skipped{incomplete,duplicate,            |
             |            excluded,expired}                |
             |    warnings{access_token_already_expired,   |
             |             missing_team_id,                |
             |             missing_principal_id}           |
             +---------------------------------------------+

  !! refresh tokens are SINGLE-HOLDER
     same account in CPA and Sub2API at once
       -> one side eventually returns invalid_grant
       -> use --exclude-emails to keep deployments disjoint
```

看不懂沒關係，**下一節會把每一層拆開來講，並貼上對應的原始碼**。

---

## 程式邏輯逐段講解

這一節是本 README 的核心。看完你應該能**自己改這支腳本**。

腳本只有一個檔案：`scripts/convert_xai_auth.mjs`，約 380 行，分成六層：

| 層 | 主要函式 | 一句話職責 |
|---|---|---|
| **讀取層** | `loadInput()` / `loadFile()` | 把檔案（或整個資料夾）的文字讀進來，變成 JSON |
| **辨識層** | `extractRecords()` | 在任意巢狀結構裡把「帳號」挖出來 |
| **正規化層** | `canonicalize()` | 把五花八門的欄位名，統一成 13 個固定欄位 |
| **篩選層** | `main()` 裡的過濾管線 | 丟掉不完整、重複、被排除、已過期的 |
| **渲染層** | `toCpa()` / `toSub2api()` | 把統一格式，長成兩邊各自要的樣子 |
| **輸出層** | `writeJson()` + 報告 | 寫檔、產 manifest、印報告 |

### 設計構思：為什麼要有「中間格式」

最直覺的寫法是：**遇到什麼格式，就寫一段程式把它直接轉成目標格式**。

```text
❌ 直接轉（N × M 條路）

grokcli admin  ──► CPA        grokcli admin  ──► Sub2API
grokcli native ──► CPA        grokcli native ──► Sub2API
CPA 檔          ──► CPA        CPA 檔          ──► Sub2API
Sub2API 檔      ──► CPA        Sub2API 檔      ──► Sub2API
JSONL          ──► CPA        JSONL          ──► Sub2API

→ 5 種輸入 × 2 種輸出 = 10 段轉換程式
→ 「email 要去哪裡找」這個規則，要寫 10 次
→ 改一個欄位規則，要同時改 10 個地方，漏一個就出 bug
```

這樣寫，未來每多一種輸入格式、或多一種輸出目標，程式碼就爆炸成長。

本專案採用的是**中間格式（canonical model）** 的做法：

```text
✅ 經過中間格式（N + M 條路）

grokcli admin  ─┐
grokcli native ─┤
CPA 檔          ─┼──► 【13 個標準欄位】 ─┬──► toCpa()      ──► CPA 檔
Sub2API 檔      ─┤       中間格式         └──► toSub2api()  ──► Sub2API payload
JSONL / 文字    ─┘

→ 5 段讀取 + 2 段渲染 = 7 段程式
→ 欄位規則只有一個地方（canonicalize）
→ 未來要加第三個目的地，只要多寫一個 toXxx()
```

**中間格式就是 `canonicalize()` 回傳的那個物件**，13 個欄位：

```js
return {
  email,                    // 帳號 email
  access_token: access,     // 門票（必需）
  refresh_token: refresh,   // 換票券（必需）
  id_token: idToken,        // 身分證（可空）
  token_type: ...,          // 固定 "Bearer"
  scope: ...,               // 權限範圍
  client_id: ...,           // 應用程式 ID
  principal_id: principal,  // 使用者 ID
  team_id: ...,             // 團隊 ID（可空）
  account_id: accountId,    // issuer::principal_id
  expires_at: expEpoch,     // 過期時間（Unix 秒）
  last_refresh: iatEpoch,   // 發證時間（Unix 秒）
  disabled: src.disabled === true,
  source_disabled_reason: ...,
};
```

**注意這裡的時間是「Unix 秒」，不是字串。** 這是刻意的設計：

```text
來源（各種格式）──► 中間格式（統一用 Unix 秒）──► 渲染層（各自轉成字串）
   毫秒 / 秒 /                    ↑                    ├─ toIso()   → 不含毫秒（CPA）
   ISO 字串 / JWT exp        統一在這裡              └─ toIsoMs() → 含毫秒（Sub2API）
```

**為什麼中間格式要存數字而不是字串？** 因為數字才好比較。篩選層要判斷「這個 token 過期了嗎」，用 `r.expires_at <= nowEpoch` 一行就搞定；如果存字串，每次比較都要重新 parse。**該做格式化的時候再格式化**，這是一條通用原則。

這個模式在軟體設計上很常見，有時叫 **Hub-and-Spoke（軸輻式）**，有時叫 **Canonical Data Model**。你在寫任何「多對多轉換」的程式時都可以套用。

---

### 第 1 步：把檔案讀進來（讀取層）

**負責的函式**：`loadInput()` → `loadFile()`

#### 白話說明

你給 `--input` 一個路徑，它可能是：

- **一個資料夾** → 要把裡面每個相關檔案都掃一遍
- **一個檔案** → 直接處理它

#### `loadInput()` 的邏輯

```js
function loadInput(input) {
  const out = [];
  const st = fs.statSync(input);
  if (st.isDirectory()) {
    const files = fs.readdirSync(input)
      .filter(f => /\.(json|jsonl|txt)$/i.test(f))
      .filter(f => f.toLowerCase() !== "manifest.json" && f.toLowerCase() !== "sha256sums")
      .sort();
    for (const f of files) loadFile(path.join(input, f), out);
  } else {
    loadFile(input, out);
  }
  return out;
}
```

逐句拆解：

| 這行在做什麼 | 為什麼要這樣做 |
|---|---|
| `fs.statSync(input)` | 問作業系統「這個路徑是檔案還是資料夾」 |
| `.filter(/\.(json\|jsonl\|txt)$/i)` | 只要這三種副檔名。`/i` 表示不分大小寫，所以 `.JSON` 也吃 |
| 排除 `manifest.json` | **那是本工具自己產生的清單檔**，裡面沒有帳號 |
| 排除 `sha256sums` | 那是校驗檔，不是資料 |
| `.sort()` | **讓結果可重現**。不排序的話，檔案系統回傳順序可能每次不同，導致去重時「誰先被留下」不固定 |
| `out` 用參數傳進去 | 這叫 **accumulator（累加器）模式**，所有遞迴呼叫共用同一個陣列，不用一直合併 |

#### 為什麼要排除 `manifest.json`（新手最常踩的坑）

假設你第一次跑完，輸出目錄長這樣：

```text
converted/cpa/
├── manifest.json          ← 本工具產的清單
└── per-account/
    ├── xai-a@example.com.json
    └── xai-b@example.com.json
```

如果你第二次把 `converted/cpa/` 當成 `--input`（想做 round-trip 轉成 Sub2API），沒有排除規則的話，`manifest.json` 也會被讀進來。它裡面沒有 token，會被判定為「不完整」，讓 `skipped.incomplete` 多一筆，讓你以為有帳號漏掉了。

**這條規則不是潔癖，是避免「自己吃自己的輸出」造成誤報。**

#### `loadFile()`：怎麼判斷檔案格式

```js
function loadFile(file, out) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const hint = path.basename(file).replace(/^xai-/, "").replace(/\.(json|jsonl|txt)$/i, "");

  if (ext === ".jsonl") {
    // 逐行解析
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s[0] !== "{") continue;
      try { extractRecords(JSON.parse(s), hint, out); } catch {}
    }
    return;
  }

  try {
    extractRecords(JSON.parse(raw), hint, out);   // 先試整檔
    return;
  } catch {}

  // 整檔失敗 → 降級為「一行一個 JSON」
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] !== "{") continue;
    try { extractRecords(JSON.parse(s), hint, out); } catch {}
  }
}
```

三個重點：

**① `replace(/^\uFEFF/, "")` 是在幹嘛？**

有些 Windows 程式存 UTF-8 檔案時，會在開頭偷偷塞一個看不見的字元（叫 **BOM**，Byte Order Mark，代碼是 `U+FEFF`）。你用文字編輯器看不出來，但 `JSON.parse()` 會直接報錯說「第 1 個字元不合法」。這行就是把它砍掉。

**② 「先試最嚴格的，失敗才降級」**

```text
副檔名是 .jsonl？
  │
  ├─ 是 → 直接逐行解析（因為 JSONL 本來就不是合法的單一 JSON）
  │
  └─ 否 → 試著整檔 JSON.parse()
            │
            ├─ 成功 → 交給 extractRecords()
            │
            └─ 失敗 → 那大概是「標題行 + 每行一個 JSON」的文字匯出
                       → 逐行掃，不是 { 開頭的行直接跳過
```

這叫 **sniffing（嗅探）**。好處是：**使用者不用告訴腳本「我這是什麼格式」，腳本自己試出來。**

**③ `hint` 是什麼，為什麼需要它**

```js
const hint = path.basename(file).replace(/^xai-/, "").replace(/\.(json|jsonl|txt)$/i, "");
```

把 `xai-user@example.com.json` 這個檔名，處理成 `user@example.com`。

**為什麼？** 因為有些 auth 檔案**裡面根本沒寫 email**，email 只存在檔名上。這時候檔名就是最後的線索。`canonicalize()` 取 email 的順序最後一項就是它：

```js
const email =
  src.email || cred.email || (src.extra && src.extra.email) ||
  pl.email || idpl.email || hintName || "";
//                          ↑ 前面全都沒有，才用檔名
```

**④ `catch {}` 為什麼吞掉錯誤？**

```js
try { extractRecords(JSON.parse(s), hint, out); } catch {}
```

因為在逐行掃描的情境下，**遇到一行壞掉的資料，不應該讓整批 200 個帳號全部失敗**。跳過那一行，繼續處理其他的，最後從報告裡的 `source_records_seen` 數量對不上，你就知道有東西被跳過了。

> 這是一個**刻意的權衡**：容錯 vs 明確報錯。這裡選容錯，因為批量處理時「盡量救回能救的」比「全有全無」實用。

---

### 第 2 步：在任意巢狀裡挖出帳號（辨識層）

**負責的函式**：`extractRecords()`

#### 白話說明

到這一步，你手上有一個已經 parse 好的 JavaScript 物件。但**帳號可能藏在任意深度**：

```text
形狀 A：{ auth: { "https://auth.x.ai::uuid": { key, refresh_token } } }
                                              ↑ 在這（第 3 層）

形狀 B：{ accounts: [ { name, credentials: { access_token } } ] }
                                              ↑ 在這（第 4 層）

形狀 C：{ access_token, refresh_token, email }
          ↑ 在這（第 1 層）

形狀 D：[ {...}, {...}, {...} ]
            ↑ 陣列裡每個都是
```

#### 為什麼用遞迴

**如果不用遞迴**，你得為每種形狀寫一段 `if`，而且巢狀層數一多就寫不完：

```js
// ❌ 這樣寫會失控
if (obj.auth) { for (...) { if (obj.auth[k].accounts) { for (...) { ... } } } }
```

**用遞迴的話**，你只需要描述「遇到某種形狀時，該往哪裡繼續找」，剩下的深度問題自動解決：

```js
function extractRecords(node, hintName, out) {
  if (node == null) return;                                    // ① 終止條件

  if (Array.isArray(node)) {                                   // ② 陣列 → 每個元素再找
    for (const item of node) extractRecords(item, hintName, out);
    return;
  }
  if (typeof node !== "object") return;                         // ③ 不是物件 → 沒東西可找

  // ④ grokcli-2api admin 匯出：{ "auth": { "<account_id>": {...} } }
  if (node.auth && typeof node.auth === "object" && !Array.isArray(node.auth)) {
    for (const [k, v] of Object.entries(node.auth)) extractRecords(v, k, out);
    //                                                            ↑ key 當 hint！
    return;
  }

  // ⑤ sub2api-data / CPA 彙總 / grokcli 匯出：{ accounts: [...] }
  if (Array.isArray(node.accounts)) {
    for (const item of node.accounts) extractRecords(item, hintName, out);
    return;
  }

  // ⑥ Sub2API 帳號物件：credentials 巢狀
  if (node.credentials && typeof node.credentials === "object") {
    const merged = Object.assign({}, node.credentials, {
      email: node.credentials.email || (node.extra && node.extra.email) || node.name,
      disabled: node.disabled,
    });
    out.push(canonicalize(merged, hintName));
    return;
  }

  // ⑦ 平的帳號物件（grokcli 原生 xai 檔、CPA auth 檔、admin auth entry）
  if (node.access_token || node.key || node.refresh_token) {
    out.push(canonicalize(node, hintName));
    return;
  }
}
```

#### 逐條解釋

| 編號 | 判斷 | 做什麼 | 為什麼 |
|---|---|---|---|
| ① | `node == null` | 直接回傳 | **遞迴的終止條件**。沒有這個會無限迴圈 |
| ② | 是陣列 | 對每個元素再呼叫自己 | 陣列本身不是帳號，裡面的才是 |
| ③ | 不是物件 | 直接回傳 | 字串、數字裡面不可能有帳號 |
| ④ | 有 `auth` 物件 | 對每個 value 遞迴，**並把 key 當 hint** | 這是 grokcli-2api 的形狀，key 就是 `account_id` |
| ⑤ | 有 `accounts` 陣列 | 對每個元素遞迴 | Sub2API 和 CPA 彙總檔都是這形狀 |
| ⑥ | 有 `credentials` 物件 | **攤平後**收下 | Sub2API 把 token 包在 `credentials` 裡 |
| ⑦ | 有 `access_token` 或 `key` 或 `refresh_token` | 直接收下 | 這是最基本的「平物件」形狀 |

**注意每個分支都有 `return`。** 這表示「找到符合的形狀就停，不再往下試其他分支」——**先判斷的優先**。順序不能亂改，例如 ⑦ 如果放到 ④ 前面，grokcli admin 匯出的外層可能被誤判。

#### ④ 為什麼要把 key 當 hint（很巧妙的一手）

grokcli-2api 的匯出：

```json
{
  "auth": {
    "https://auth.x.ai::0552a0b9-953e-43ce-bd11-9eb435cec24a": {
      "key": "eyJ...",
      "refresh_token": "mmhF..."
    }
  }
}
```

注意：**`account_id` 是這個物件的 key，不是裡面的欄位。** 如果不把 key 傳下去，這個資訊就永遠丟了。

所以 `extractRecords(v, k, out)` 把 key 當 `hintName` 傳進去。雖然它最後主要用在 email 的備援，但這個「**把外層資訊帶著往下走**」的手法，是處理巢狀資料時很常用的技巧。

#### ⑥ 為什麼要用 `Object.assign()` 攤平

Sub2API 的帳號物件長這樣：

```json
{
  "name": "user@example.com",
  "platform": "grok",
  "credentials": { "access_token": "...", "refresh_token": "..." },
  "extra": { "email": "user@example.com" },
  "disabled": false
}
```

email 可能出現在**三個地方**：`credentials.email`、`extra.email`、`name`。而 token 在 `credentials` 裡面。

```js
const merged = Object.assign({}, node.credentials, {
  email: node.credentials.email || (node.extra && node.extra.email) || node.name,
  disabled: node.disabled,
});
```

意思是：**以 `credentials` 為底，補上從外層撿來的 email 和 disabled**，攤成一個平物件再交給 `canonicalize()`。

這樣 `canonicalize()` 就不用知道 Sub2API 的結構長什麼樣——**複雜度被隔離在辨識層**。

#### 一個附加好處：可以反向 round-trip

因為 ⑤⑥ 認得 Sub2API 的形狀、⑦ 認得 CPA 的形狀，所以：

```text
Sub2API 檔 ──► 本腳本 ──► CPA 檔      ✅ 可以
CPA 檔     ──► 本腳本 ──► Sub2API 檔  ✅ 也可以
```

這**不是刻意設計的功能，是遞迴 + 中間格式自然帶來的副產品**。好的架構常常會這樣：你為了 A 目的做的設計，順便解決了 B 問題。

---
### 第 3 步：湊出十三個欄位（正規化層）

**負責的函式**：`canonicalize()`，搭配工具函式 `jwtPayload()`、`toEpoch()`

這是整支腳本**最重要**的一段。所有「相容性智慧」都集中在這裡。

#### 核心手法：`||` 串接

JavaScript 的 `||`（or）運算子有個特性：**回傳第一個「有值」的東西**。

```js
const access = src.access_token || src.accessToken || src.key || src.token || "";
```

意思是：先看 `access_token` 有沒有值，沒有就看 `accessToken`，再沒有就看 `key`……全部都沒有就給空字串。

**這一行就取代了一大串 `if / else if`。** 讀起來像一份「優先順序清單」。

> ⚠️ 小陷阱：`||` 會把 `0`、`""`、`false` 也當成「沒有值」。對 token 這種字串來說沒問題（空字串本來就該跳過），但如果你要處理「數字 0 是合法值」的欄位，就得改用 `??`（nullish coalescing）。本腳本的欄位都不需要，所以用 `||` 最簡潔。

#### 三層解析優先序（設計核心）

每個欄位都遵守同一個原則：

```text
① 來源檔案明確寫的欄位
        ↓ 沒有
② 從 access_token 的 JWT payload 挖出來
        ↓ 沒有
③ xAI 文件上的預設值（寫死在常數）
```

**為什麼是這個順序？**

| 順位 | 為什麼排這裡 |
|---|---|
| ① 來源欄位 | **最可信**。工具明確存下來的值，代表它自己確認過 |
| ② JWT claim | **次可信**。是 xAI 簽發的，一定正確，但可能不完整 |
| ③ 寫死預設 | **最後手段**。至少能讓帳號跑起來，不會因為缺一個 `scope` 就整筆丟掉 |

實際的常數（寫在檔案最上面）：

```js
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_ISSUER = "https://auth.x.ai";
const CPA_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const CPA_TOKEN_HEADER = { "X-XAI-Token-Auth": "xai-grok-cli" };
const DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";
```

> 這些都是 **grok-cli 這個官方公開客戶端的公開識別值**，不是任何人的私密資料。放在原始碼裡是安全的。

#### `jwtPayload()`：怎麼解 JWT

```js
function jwtPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) return {};
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch { return {}; }
}
```

一步一步：

| 步驟 | 程式 | 說明 |
|---|---|---|
| 1 | `typeof token !== "string"` | 不是字串就不用試了 |
| 2 | `!token.includes(".")` | 沒有點就不是 JWT（可能是 API key 之類） |
| 3 | `token.split(".")[1]` | 用點切三段，取**中間**那段（index 1） |
| 4 | `Buffer.from(..., "base64url")` | Base64URL 解碼成位元組 |
| 5 | `.toString("utf8")` | 位元組變成文字 |
| 6 | `JSON.parse(...)` | 文字變成物件 |
| 7 | `catch { return {} }` | 任何一步失敗就回傳**空物件** |

**⑦ 為什麼回傳空物件而不是 `null`？**

因為呼叫端可以直接寫 `pl.exp` 而不用先檢查：

```js
const pl = jwtPayload(access);   // 保證是物件
const expEpoch = toEpoch(pl.exp) || ...;   // 不會爆
```

如果回傳 `null`，每次用都得寫 `pl && pl.exp`。**這叫 Null Object Pattern（空物件模式）**：用一個「什麼都沒有但形狀正確」的物件，取代 `null` 檢查。

#### `toEpoch()`：吃各種時間格式

```js
function toEpoch(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") {
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}
```

它能吃四種輸入：

| 輸入例子 | 走哪條路 | 結果 |
|---|---|---|
| `1786291200`（數字，秒） | 第 2 行 | `1786291200` |
| `1786291200000`（數字，毫秒） | 第 2 行，`> 1e12` 成立 | 除以 1000 → `1786291200` |
| `"1786291200"`（字串數字） | 第 3-4 行，`Number()` 轉成功 | `1786291200` |
| `"2026-08-08T12:00:00Z"`（ISO 字串） | 最後 `Date.parse()` | `1786291200` |
| `null` / `""` / 亂碼 | 各種防守 | `0` |

**回傳 `0` 代表「沒有」**，因為 `0` 在 `||` 串接裡會被當成「沒有值」而繼續往下找。這讓 `toEpoch(a) || toEpoch(b) || toEpoch(c)` 這種寫法能自然運作。

#### 每個欄位的取得策略

##### access_token（必需）

```js
const access =
  src.access_token || src.accessToken || src.key || src.token ||
  (src.credentials && src.credentials.access_token) || "";
```

五個位置，**`key` 是關鍵**（grokcli-2api admin 匯出用它）。`accessToken` 是駝峰命名的變體，某些工具會這樣寫。

##### refresh_token（必需）

```js
const refresh =
  src.refresh_token || src.refreshToken ||
  (src.credentials && src.credentials.refresh_token) || "";
```

##### email（必需）

```js
const email =
  src.email || cred.email || (src.extra && src.extra.email) ||
  pl.email || idpl.email || hintName || "";
```

六個位置，優先序是：**來源欄位 → 巢狀欄位 → access token JWT → id token JWT → 檔名**。

注意這裡同時解了兩個 JWT：

```js
const pl = jwtPayload(access);     // access token 的 payload
const idpl = jwtPayload(idToken);  // id token 的 payload
```

**為什麼要解 id token？** 因為 id token 專門用來描述「你是誰」，email 這種身分資訊在裡面通常更完整。access token 的重點是權限，不一定有 email。

##### principal_id

```js
const principal =
  src.principal_id || src.user_id || src.sub || pl.principal_id || pl.sub || idpl.sub || "";
```

六個位置。`sub` 是 OAuth 標準裡「subject」的欄位名，`user_id` 和 `principal_id` 是不同工具的叫法。

##### account_id

```js
const accountId =
  src.account_id || src.id ||
  (principal ? XAI_ISSUER + "::" + principal : "");
```

**如果來源有寫就直接用；沒有的話，用 `principal_id` 自己組出來。** 這就是 `https://auth.x.ai::<uuid>` 那個格式。

注意 `principal ? ... : ""` ——如果連 `principal_id` 都沒有，就回空字串，不要組出一個 `https://auth.x.ai::` 這種殘缺的 ID。

##### expires_at（過期時間）

```js
const expEpoch =
  toEpoch(src.expires_at) || toEpoch(cred.expires_at) || toEpoch(src.expired) ||
  toEpoch(pl.exp) ||
  (src.expires_in && src.last_refresh
    ? toEpoch(src.last_refresh) + Number(src.expires_in) : 0);
```

四層備援，**注意順序：來源欄位排在 JWT `exp` 前面**。原始碼裡有註解說明原因：

> `// Explicit source expiry wins; grokcli-2api stores the authoritative value and`
> `// it can differ from the JWT exp claim by a second. JWT exp is the fallback.`

翻譯：**grokcli-2api 存的過期時間，和 JWT 裡的 `exp` 可能差一秒。** 既然來源工具自己記了一份，就以它為準——它比較知道自己的狀態。

最後一層 `last_refresh + expires_in` 是**算出來的**：有些格式只記「發證時間」和「幾秒後過期」，沒有直接記絕對時間。

##### last_refresh（上次刷新時間）

```js
const iatEpoch = toEpoch(pl.iat) || toEpoch(src.last_refresh) || toEpoch(src.create_time);
```

**這裡順序反過來了：JWT `iat` 優先。** 為什麼？因為 `iat` 是 xAI 簽發時寫進 token 的，**就是這張 token 真正的發放時刻**，比來源工具記的「我上次刷新是什麼時候」更精確。

> 這兩個欄位的優先序刻意不同，是因為它們的語意不同：`exp` 是「預測」（會被續期改變），`iat` 是「事實」（已經發生的簽發時刻）。

##### scope / client_id / team_id

```js
scope: pl.scope || src.scope || cred.scope || DEFAULT_SCOPE,
client_id: pl.client_id || src.oidc_client_id || src.client_id || cred.client_id || pl.aud || XAI_CLIENT_ID,
team_id: src.team_id || pl.team_id || "",
```

- `scope` 和 `client_id` **JWT 優先**，因為這兩個是 xAI 簽發時決定的事實
- `client_id` 有一個特別的備援 `pl.aud` ——OAuth 標準裡 `aud`（audience）通常就是 client id
- `team_id` **允許空**，因為不是每個帳號都屬於某個 team

#### 必填欄位檢查：`isUsable()`

```js
function isUsable(rec) {
  return Boolean(rec.access_token && rec.refresh_token && rec.email);
}
```

只要這三個有任一個缺，整筆就在篩選層被丟掉，計入 `skipped.incomplete`。

**為什麼是這三個？**

| 欄位 | 為什麼非它不可 |
|---|---|
| `access_token` | 沒有門票，什麼都做不了 |
| `refresh_token` | 沒有換票券，幾小時後就變廢帳號，匯進去是浪費 |
| `email` | **檔名和帳號辨識都靠它**。CPA 的檔名格式就是 `xai-<email>.json` |

注意 `id_token`、`team_id` **不在必填清單**。它們缺了照樣能用。

> 這裡展現一個重要的設計判斷：**必填清單要「剛好夠用」，不能貪心。** 如果把 `team_id` 也列必填，很多本來能用的帳號會被誤殺。

---

### 第 4 步：過濾管線（篩選層）

**位置**：`main()` 函式裡

#### 白話說明

現在你有一大堆正規化好的帳號。這一層負責**篩掉不該匯出的**，並且**記錄每筆是為什麼被篩掉**。

```js
const seen = new Set();
const skipped = { incomplete: 0, duplicate: 0, excluded: 0, expired: 0 };
let records = [];
for (const r of raw) {
  if (!isUsable(r)) { skipped.incomplete++; continue; }
  const key = (r.account_id || r.email).toLowerCase();
  if (seen.has(key)) { skipped.duplicate++; continue; }
  if (exclude.has(String(r.email).toLowerCase())) { skipped.excluded++; continue; }
  if (a.skipExpired && r.expires_at && r.expires_at <= nowEpoch) { skipped.expired++; continue; }
  seen.add(key);
  records.push(r);
}
if (a.limit > 0) records = records.slice(0, a.limit);
```

#### 四道關卡

```text
所有正規化後的帳號
      │
      ▼
【關卡 1】isUsable()？          ──否──► skipped.incomplete++
      │是
      ▼
【關卡 2】看過這個 key 了？      ──是──► skipped.duplicate++
      │否
      ▼
【關卡 3】在排除清單裡？         ──是──► skipped.excluded++
      │否
      ▼
【關卡 4】--skip-expired 且過期？──是──► skipped.expired++
      │否
      ▼
   收下，記錄 key
      │
      ▼
【最後】--limit N ？──► 只留前 N 筆
```

#### 關卡 2 的去重 key 為什麼要「退回 email」

```js
const key = (r.account_id || r.email).toLowerCase();
```

**優先用 `account_id`**，因為它才是真正的唯一識別。同一個帳號可能在不同匯出檔裡 email 大小寫不同，但 `account_id` 一定一樣。

**`account_id` 沒有時退回 email**，因為總比完全不去重好。

**`.toLowerCase()` 是必要的**：email 在多數系統裡不分大小寫，`User@Example.com` 和 `user@example.com` 是同一個人。不轉小寫的話會被當兩筆而重複匯入。

#### `Set` 是什麼

JavaScript 的 `Set` 是「不重複集合」。`seen.has(key)` 查詢速度是 **O(1)**（常數時間），跟裡面有幾筆無關。

如果用陣列加 `.includes()`，每次查詢是 **O(n)**，1000 筆資料就要比對 1000 次，總共 100 萬次比對。**用 Set 是 1000 次。**

> 這是一個很實用的效能常識：**需要反覆問「有沒有見過這個」，就用 Set 或 Map，不要用陣列。**

#### 關卡 3：`--exclude-emails` 為什麼存在（重要）

這個參數的存在理由是**避免帳號被兩邊同時持有**。

```text
同一份 refresh token
        │
        ├──► CPA      用它換新 token → 舊的作廢
        │
        └──► Sub2API  用舊的去換 → invalid_grant ❌
```

**refresh token 通常是「一次性」的**：用掉一次就換成新的，舊的立刻失效。所以同一個帳號同時丟進兩套環境，其中一邊遲早會拿到：

```text
invalid_grant / Refresh token has been revoked
```

`--exclude-emails` 讓你維持**部署互斥**：

```bash
# 第一批 100 個給 CPA
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out-cpa \
  --target cpa --limit 100

# 記下已用掉的 email 到 cpa-used.txt，第二批給 Sub2API 時排除
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out-sub \
  --target sub2api --exclude-emails ./cpa-used.txt
```

參數本身支援**兩種寫法**，程式會自己判斷：

```js
if (fs.existsSync(a.excludeEmails)) {
  // 是檔案 → 一行一個 email
  for (const line of fs.readFileSync(a.excludeEmails, "utf8").split(/\r?\n/)) {
    const s = line.trim(); if (s) exclude.add(s.toLowerCase());
  }
} else {
  // 不是檔案 → 當成逗號分隔清單
  for (const s of a.excludeEmails.split(",")) if (s.trim()) exclude.add(s.trim().toLowerCase());
}
```

**先檢查是不是檔案，不是就當清單。** 這種「一個參數兩種用法」的設計，對只想排除兩三個 email 的人很方便，不用特地開一個檔案。

#### 關卡 4：為什麼過期不是預設篩掉

```js
if (a.skipExpired && r.expires_at && r.expires_at <= nowEpoch) { ... }
```

注意要**明確加 `--skip-expired`** 才會生效。預設是**不篩掉**。

**為什麼？** 因為 `access_token` 過期是**正常狀態**，而且**可以救**：只要 `refresh_token` 還有效，CPA / Sub2API 匯入後會自動用它換一張新門票。

如果預設篩掉，你會白白丟掉一大批其實可用的帳號。

所以報告裡 `warnings.access_token_already_expired` 是**警告，不是錯誤**：

```text
warnings.access_token_already_expired: 4
   ↑ 這 4 個帳號的門票過期了，但還是會被匯出
     匯入後會自動用 refresh token 續期
```

---
### 第 5 步：長成兩邊要的樣子（渲染層）

**負責的函式**：`toCpa()`、`toSub2api()`

到這一步，資料已經完全統一。渲染層的工作很單純：**照著目標格式排列欄位**。

#### `toCpa()`：CPA 要的形狀

```js
function toCpa(rec) {
  return {
    type: "xai",
    auth_kind: "oauth",
    email: rec.email,
    access_token: rec.access_token,
    refresh_token: rec.refresh_token,
    token_type: rec.token_type,
    expired: toIso(rec.expires_at),          // ← 不含毫秒
    last_refresh: toIso(rec.last_refresh),   // ← 不含毫秒
    base_url: CPA_BASE_URL,
    headers: Object.assign({}, CPA_TOKEN_HEADER),
    disabled: false,
    account_id: rec.account_id,
    user_id: rec.principal_id,
    sub: rec.principal_id,
    team_id: rec.team_id,
    oidc_client_id: rec.client_id,
    scope: rec.scope,
  };
}
```

幾個要注意的點：

**① 欄位名改掉了**

| 中間格式 | CPA 叫法 |
|---|---|
| `expires_at` | `expired` |
| `principal_id` | `user_id` **和** `sub`（同一個值寫兩個欄位！） |
| `client_id` | `oidc_client_id` |

**`user_id` 和 `sub` 為什麼要寫兩份同樣的值？** 因為 CPA 內部不同程式路徑會讀不同欄位。兩個都填是最保險的做法——這是實測得出的結論，不是理論。

**② `Object.assign({}, CPA_TOKEN_HEADER)` 為什麼不直接用常數**

```js
headers: Object.assign({}, CPA_TOKEN_HEADER),   // ✅
headers: CPA_TOKEN_HEADER,                       // ❌ 危險
```

如果直接寫 `CPA_TOKEN_HEADER`，那 **200 個帳號的 `headers` 會全部指向同一個物件**。以後任何人改了其中一個帳號的 header，另外 199 個會一起被改。

`Object.assign({}, x)` 是**淺拷貝**，每個帳號拿到自己的副本。

> 這是 JavaScript 新手最常見的 bug 來源之一：**物件是「參考傳遞」，不是複製。** 要複製得明確寫出來。

**③ `disabled: false` 一律寫死**

```js
disabled: false,
```

即使中間格式裡有 `rec.disabled`（來源池標記為停用），輸出**還是寫 `false`**。

**為什麼這樣設計？** 因為「在來源池被停用」和「在目標池要不要啟用」是**兩件不同的事**。你可能就是因為某帳號在 A 機器被停用，才要把它搬到 B 機器。如果轉檔時自動幫你停用，你反而得手動去後台一個一個開。

**但這是一個需要你知道的行為**：如果你的來源池有一堆刻意停用的死帳號，它們也會被匯出成啟用狀態。要避免的話，去來源池先確認狀態，或用 `--exclude-emails` 排除。

#### `toSub2api()`：Sub2API 要的形狀

```js
function toSub2api(rec, baseUrl) {
  return {
    name: rec.email,
    platform: "grok",
    type: "oauth",
    credentials: {
      access_token: rec.access_token,
      refresh_token: rec.refresh_token,
      token_type: rec.token_type,
      expires_at: toIsoMs(rec.expires_at),   // ← 含毫秒
      email: rec.email,
      client_id: rec.client_id,
      base_url: baseUrl,
    },
    extra: { email: rec.email },
    concurrency: 1,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: true,
  };
}
```

差異對照：

| 項目 | CPA | Sub2API |
|---|---|---|
| **結構** | 平的 | token 包在 `credentials` 裡 |
| **時間** | `toIso()` 不含毫秒 | `toIsoMs()` **含**毫秒 |
| **email 位置** | `email` | `name`、`credentials.email`、`extra.email`（三個地方！） |
| **base_url** | 常數寫死 | 參數可覆寫（`--sub2api-base-url`） |
| **有排程欄位** | 沒有 | `concurrency`、`priority`、`rate_multiplier` |
| **不需要的欄位** | — | 沒有 `team_id`、`scope`、`principal_id` |

**email 為什麼要寫三個地方？** 同樣是實測結論：Sub2API 後台的清單顯示讀 `name`，額度查詢讀 `credentials.email`，內部標籤讀 `extra.email`。三個都填才不會有地方顯示空白。

**`concurrency: 1` 為什麼是 1 而不是 10？** 因為 Grok 免費帳號的額度很有限（單帳號約 1M tokens 的滾動額度）。設 1 是保守值，避免同一帳號被同時發多個請求而更快撞到限制。如果你的帳號有付費方案，可以改大。

> 想改預設值的話，直接改這兩個函式裡的字面值即可，**改一處全部生效**——這就是中間格式架構帶來的好處。

---

### 第 6 步：寫檔與報告（輸出層）

#### `writeJson()`：一個小而重要的函式

```js
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
```

| 這行 | 作用 |
|---|---|
| `path.dirname(file)` | 取出檔案所在的資料夾路徑 |
| `{ recursive: true }` | **中間層資料夾不存在就一路建立**。所以你不用先手動建 `cpa/per-account/` |
| `JSON.stringify(obj, null, 2)` | `2` 表示縮排兩個空白，**產出人看得懂的排版** |

**為什麼要縮排？** 因為你可能要打開檔案人工檢查、或用 `git diff` 比對兩次匯出的差異。壓成一行的 JSON 沒辦法看 diff。

#### 四種輸出的產生條件

```js
const wantCpa = a.target === "cpa" || a.target === "both";
const wantSub = a.target === "sub2api" || a.target === "both";
const wantMerged = a.mode === "merged" || a.mode === "both";
const wantSplit = a.mode === "split" || a.mode === "both";
```

**先把「要不要」算成四個布林值**，後面就只要寫四個 `if`：

```text
if (wantCpa && wantSplit)  → cpa/per-account/*.json + cpa/manifest.json
if (wantCpa && wantMerged) → cpa/cpa-xai-merged-<N>.json
if (wantSub && wantMerged) → sub2api/sub2api-<label>-all-<N>.json
if (wantSub && wantSplit)  → sub2api/per-account/*.json
```

這比在四個地方重複寫 `a.target === "cpa" || a.target === "both"` 清楚得多。**把條件判斷抽成有名字的變數，是讓程式好讀的最便宜手段。**

#### `manifest.json` 是什麼，為什麼需要它

只有 CPA split 模式會產生：

```js
writeJson(manifest, {
  exported_at: stamp,
  format: "CLIProxyAPI xAI OAuth",
  label: a.label,
  count: records.length,
  import_hint: "POST /v0/management/auth-files (multipart file=@xai-<email>.json), one file per account",
  files: records.map(r => "xai-" + safeName(r.email) + ".json"),
});
```

**為什麼需要？** 因為 CPA 是一帳號一檔上傳。當你面前有 200 個檔案時，你會需要：

- 知道**應該有幾個**（`count`）→ 可以驗證有沒有漏
- 拿到**完整檔名清單**（`files`）→ 可以寫個 for 迴圈自動上傳
- 記得**怎麼上傳**（`import_hint`）→ 半年後回來看還記得
- 知道**什麼時候轉的**（`exported_at`）→ 排查問題時很有用

**這就是為什麼 `loadInput()` 要排除 `manifest.json`** ——它是給人和腳本看的說明書，不是帳號資料。

#### `cpa-xai-merged-<N>.json` 為什麼「不可匯入」

```js
writeJson(f, {
  type: "cliproxyapi-xai-auth-bundle",
  version: 1,
  exported_at: stamp,
  note: "CPA /v0/management/auth-files imports individual JSON files; this merged file is backup/reference only.",
  count: records.length,
  accounts: records.map(r => Object.assign({ file: "xai-" + safeName(r.email) + ".json" }, toCpa(r))),
});
```

**注意 `note` 欄位——它把「這個檔案不能匯入」直接寫在檔案裡。**

CPA 的匯入 API 只吃單一帳號的 JSON 檔。這個彙總檔存在的理由是：

| 用途 | 說明 |
|---|---|
| **備份** | 一個檔案就是全部，方便存檔 |
| **對照** | 用 `git diff` 比較兩次匯出差在哪 |
| **重跑來源** | 它自己可以當 `--input` 再轉成 Sub2API |

每筆還多了一個 `file` 欄位記錄它對應哪個 per-account 檔名，方便交叉查找。

> **設計上的提醒**：如果一個檔案很容易被誤用，除了寫在 README，**最好也在檔案內容裡寫一句話說明**。使用者拿到檔案時不一定手邊有 README。

#### 檔名消毒：`safeName()`

```js
function safeName(email) {
  return String(email).replace(/[\\\/:*?"<>|]/g, "_");
}
```

把 Windows 檔名不允許的字元（`\ / : * ? " < > |`）換成底線。

**email 裡怎麼會有這些字元？** 正常不會，但：

- 來源資料可能被污染
- `hintName` 是從檔名來的，可能不是真的 email
- 有人手動改過檔案

**如果不消毒，Windows 上 `fs.writeFileSync()` 會直接拋錯，整批中斷。** 一行防守換來的穩定性很值得。

#### 報告輸出

```js
console.log(JSON.stringify(report, null, 2));
```

**印到 stdout（標準輸出），而且是合法 JSON。** 這代表你可以：

```bash
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out > report.json
```

把報告存成檔案，或用其他工具接著處理。

**報告裡絕對不含 token 值**，只有數量、路徑、參數。這是刻意的：報告經常會被貼到聊天室或 issue 裡討論。

---

## 支援的輸入形狀（5 種）

| # | 形狀 | 關鍵特徵 | 由哪個分支認出 |
|---|---|---|---|
| 1 | **grokcli-2api admin 匯出** | `{ "auth": { "https://auth.x.ai::<uuid>": { key, refresh_token } } }`；**access token 在 `key`** | `extractRecords()` ④ |
| 2 | **原生 grokcli auth 檔** | `xai-<email>.json`，含 `type: "xai"`、`access_token`、`refresh_token`、`sub` | `extractRecords()` ⑦ |
| 3 | **CPA auth 檔** | 平物件，含 `base_url`、`headers` | `extractRecords()` ⑦ |
| 4 | **Sub2API payload** | `accounts[].credentials` | `extractRecords()` ⑤⑥ |
| 5 | **JSON 陣列 / JSONL / 文字匯出** | 每行一個 JSON 物件 | `loadFile()` 的降級路徑 |

**③④ 表示可以反向 round-trip**：CPA 檔轉回 Sub2API、Sub2API 檔轉成 CPA，都可以。

資料夾模式的跳過規則：

| 規則 | 為什麼 |
|---|---|
| 只讀 `.json` / `.jsonl` / `.txt` | 其他副檔名不可能是資料 |
| 跳過 `manifest.json` | **那是本工具產的清單檔**，沒有帳號 |
| 跳過 `SHA256SUMS` | 那是校驗檔 |

---

## 四種輸出：兩軸交叉出來的

輸出不是隨便定的四種，是**兩個獨立的軸交叉**：

```text
                 --mode merged          --mode split
              ┌──────────────────────┬──────────────────────┐
--target cpa  │ cpa-xai-merged-N     │ per-account/         │
              │ .json                │   xai-<email>.json   │
              │ （備份用，不可匯入）  │ + manifest.json      │
              │                      │ ← CPA 實際匯入這些   │
              ├──────────────────────┼──────────────────────┤
--target      │ sub2api-<label>-     │ per-account/         │
  sub2api     │   all-N.json         │   <email>_sub2api    │
              │ ← Sub2API 批量匯入   │   .json              │
              │                      │ （先驗證單筆用）      │
              └──────────────────────┴──────────────────────┘
```

**兩軸的意義完全不同：**

| 軸 | 決定什麼 | 選錯的後果 |
|---|---|---|
| `--target` | **格式**（欄位名、時間精度、結構） | 匯入被拒或匯入成功但呼叫失敗 |
| `--mode` | **打包方式**（一大包還是一堆小檔） | 匯入介面直接不接受 |

### 該用哪一個

```text
你要匯到哪裡？
  │
  ├─ CPA
  │    └─► --target cpa --mode split
  │          用 per-account/xai-<email>.json
  │          （merged 那個只是備份，不要拿去匯入）
  │
  └─ Sub2API
       │
       ├─ 第一次，想先確認格式對不對
       │    └─► --target sub2api --mode split
       │          拿一個 <email>_sub2api.json 先試
       │
       └─ 確認過了，要批量
            └─► --target sub2api --mode merged
                  用 sub2api-<label>-all-N.json
```

**不要一開始就丟 200 個帳號。** 先用 split 拿一筆試匯入，成功再放大。

---

## 參數說明

| 參數 | 值 | 預設 | 說明 |
|---|---|---|---|
| `--input` | 檔案或資料夾 | **必填** | 來源匯出。資料夾會讀 `*.json`、`*.jsonl`、`*.txt`，並跳過 `manifest.json` / `SHA256SUMS` |
| `--outdir` | 資料夾 | **必填** | 輸出根目錄，會自動建立 `cpa/` 與 `sub2api/` |
| `--target` | `cpa` \| `sub2api` \| `both` | `both` | 要產出哪些格式 |
| `--mode` | `merged` \| `split` \| `both` | `both` | 彙總檔、單帳號檔、或兩者 |
| `--label` | 字串 | `xai` | 用於輸出檔名的標籤，例如 `--label batch01` 產出 `sub2api-batch01-all-50.json` |
| `--limit` | 整數 | `0`（不限） | **去重後**只保留前 N 筆 |
| `--skip-expired` | 旗標（不用給值） | 關 | 丟掉 access token 已過期的帳號 |
| `--exclude-emails` | 檔案路徑或逗號清單 | 無 | 排除這些 email（避免重複部署） |
| `--sub2api-base-url` | URL | `https://cli-chat-proxy.grok.com/v1` | 覆寫 Sub2API 的 `credentials.base_url` |

### 參數解析的設計

```js
default:
  throw new Error("unknown argument: " + k);
```

**傳入未知參數會直接中止，不會默默忽略。**

**為什麼這很重要？** 假設你打錯字寫成 `--taget cpa`。如果程式默默忽略，它會用預設值 `both` 跑完，你以為只產了 CPA，結果多產了 Sub2API 檔案。**沉默的錯誤比明顯的錯誤危險。**

而且因為 `parseArgs()` 在最前面就跑，**中止時還沒建立任何目錄**，不會留下半殘的輸出。

---

## 輸出目錄結構

```text
<outdir>/
├── cpa/
│   ├── cpa-xai-merged-<N>.json        # 僅備份 / 對照用，不可匯入
│   ├── manifest.json                  # 數量 + 檔案清單 + 匯入提示
│   └── per-account/
│       └── xai-<email>.json           # ← CPA 實際匯入的就是這些
└── sub2api/
    ├── sub2api-<label>-all-<N>.json   # ← Sub2API 批量匯入
    └── per-account/
        └── <email>_sub2api.json       # 先驗證單一帳號用
```

**檔名裡帶數量 `<N>` 是刻意的**：你光看檔名就知道裡面有幾個帳號，不用開檔案數。同一個來源轉兩次，如果數量不一樣，馬上就會發現。

---

## 匯入方式

### CPA / CLIProxyAPI

**一個帳號一個檔案。**

```bash
curl -X POST "<CPA_BASE>/v0/management/auth-files" \
  -F "file=@./converted/cpa/per-account/xai-user@example.com.json"
```

或直接把檔案放進容器的 `auths/` 目錄。

批量上傳可以照著 `manifest.json` 的 `files` 清單寫個迴圈。

> ⚠️ `cpa-xai-merged-<N>.json` **不可匯入**，它只是備份與 diff 用的彙總檔。

### Sub2API

後台匯入接受 `sub2api-data` payload 物件：

- 批量：`sub2api/sub2api-<label>-all-<N>.json`
- 先試單筆：`sub2api/per-account/<email>_sub2api.json`

---
## 欄位對應表

| 正規化欄位 | CPA 輸出 | Sub2API 輸出 | 解析順序（左優先） |
|---|---|---|---|
| access token | `access_token` | `credentials.access_token` | `access_token` / `accessToken` / **`key`** / `token` / `credentials.access_token` |
| refresh token | `refresh_token` | `credentials.refresh_token` | `refresh_token` / `refreshToken` / `credentials.refresh_token` |
| id token | 不使用 | 不使用 | `id_token` / `idToken` / `credentials.id_token`（只用來挖 email 和 sub） |
| email | `email` | `name`、`credentials.email`、`extra.email` | `email` / `credentials.email` / `extra.email` / access JWT `email` / id JWT `email` / 檔名 |
| 過期時間 | `expired`（RFC3339，**不含**毫秒） | `credentials.expires_at`（RFC3339，**含**毫秒） | `expires_at` / `credentials.expires_at` / `expired` → JWT `exp` → `last_refresh + expires_in` |
| 上次刷新 | `last_refresh` | 不使用 | JWT `iat` → `last_refresh` → `create_time` |
| principal | `user_id`、`sub`、`account_id` | 不使用 | `principal_id` / `user_id` / `sub` / JWT `principal_id` / JWT `sub` / id JWT `sub` |
| team | `team_id` | 不使用 | `team_id` / JWT `team_id`（允許空） |
| client id | `oidc_client_id` | `credentials.client_id` | JWT `client_id` / `oidc_client_id` / `client_id` / `credentials.client_id` / JWT `aud` / xAI 預設值 |
| scope | `scope` | 不使用 | JWT `scope` / `scope` / `credentials.scope` / xAI 預設值 |
| token type | `token_type` | `credentials.token_type` | `token_type` / `credentials.token_type` / `"Bearer"` |
| base url | 固定 `https://cli-chat-proxy.grok.com/v1` | `--sub2api-base-url` | 常數 / 參數 |
| auth header | `headers["X-XAI-Token-Auth"] = "xai-grok-cli"` | 不使用 | 常數 |

### 固定常數

| 項目 | 值 | 說明 |
|---|---|---|
| xAI OIDC issuer | `https://auth.x.ai` | 發證機關 |
| xAI grok-cli client_id | `b1a00492-073a-47ea-816f-4c329264a828` | grok-cli 官方公開客戶端 ID |
| `account_id` 組法 | `https://auth.x.ai::<principal_id>` | 注意是**兩個冒號** |
| 預設 scope | `openid profile email offline_access grok-cli:access api:access` | grok-cli 的標準權限集 |
| CPA 固定欄位 | `type: "xai"`、`auth_kind: "oauth"`、`disabled: false` | — |
| Sub2API 固定欄位 | `platform: "grok"`、`type: "oauth"`、`concurrency: 1`、`priority: 1`、`rate_multiplier: 1`、`auto_pause_on_expired: true` | — |

> **⚠️ `disabled: false` 的行為要記住**：CPA 輸出一律寫 `false`，所以來源池裡**被停用的帳號依然會被匯出成啟用狀態**。原因見[第 5 步](#第-5-步長成兩邊要的樣子渲染層)的說明。如果這件事對你有影響，請另外去來源池確認狀態，或用 `--exclude-emails` 排除。

### 敏感欄位不會被搬過去

來源檔案可能含這些欄位，**兩種輸出格式都不使用它們，也不會複製過去**：

| 欄位 | 是什麼 |
|---|---|
| `password` | 帳號密碼明文 |
| `sso` | SSO cookie |
| `session_cookies` | 瀏覽器 session |

因為渲染層是**明確列出要哪些欄位**（白名單），不是「複製整個物件再刪掉幾個」（黑名單）。**白名單比黑名單安全**：新來源多了一個敏感欄位時，白名單自動不會漏出去，黑名單則需要你記得去加。

---

## 執行報告怎麼讀

腳本結束時把報告以 JSON 印到 stdout：

```json
{
  "input": "./my-grok-export",
  "outdir": "./converted",
  "target": "both",
  "mode": "both",
  "source_records_seen": 120,
  "accounts_converted": 115,
  "skipped": { "incomplete": 2, "duplicate": 3, "excluded": 0, "expired": 0 },
  "cpa_per_account_files": 115,
  "sub2api_per_account_files": 115,
  "merged_files": ["..."],
  "warnings": {
    "access_token_already_expired": 4,
    "missing_team_id": 0,
    "missing_principal_id": 0
  },
  "sub2api_base_url": "https://cli-chat-proxy.grok.com/v1",
  "file_stamp": "20260808T120000Z"
}
```

### 先做一個算式檢查

```text
source_records_seen
  - skipped.incomplete
  - skipped.duplicate
  - skipped.excluded
  - skipped.expired
  = accounts_converted        ← 應該剛好相等（除非用了 --limit）
```

上面的例子：`120 - 2 - 3 - 0 - 0 = 115` ✅

**如果算不出來，代表你用了 `--limit`**（它在最後才切）。

### 每個欄位怎麼判讀

| 欄位 | 判讀 | 要不要擔心 |
|---|---|---|
| `source_records_seen` | 從來源檔案總共挖出幾筆 | 比預期少 → 檢查是不是格式沒被認出來 |
| `accounts_converted` | 最後真的寫出去幾個 | 這是最重要的數字 |
| `skipped.incomplete` | 缺 access / refresh token / email | 少量正常；**大量代表格式沒被認對** |
| `skipped.duplicate` | 依 `account_id`（退回 email）判定重複 | 正常。同一帳號出現在多個來源檔時會有 |
| `skipped.excluded` | 被 `--exclude-emails` 排除 | 應該等於你清單的筆數 |
| `skipped.expired` | 被 `--skip-expired` 丟掉 | 沒加那個參數就一定是 0 |
| `warnings.access_token_already_expired` | 門票過期，但仍匯出 | **可接受**，匯入後會自動續期 |
| `warnings.missing_team_id` | 沒有 team | 通常可忽略，個人帳號本來就沒 team |
| `warnings.missing_principal_id` | 沒有使用者 ID | **要注意**，`account_id` 會是空的，CPA 可能無法正確辨識 |
| `file_stamp` | 這次執行的時間戳 | 排查問題時用來對照 log |

### 最需要警覺的一種情況

```text
"source_records_seen": 200,
"accounts_converted": 0,
"skipped": { "incomplete": 200, ... }
```

**200 筆全部「不完整」= 你的來源格式沒被正確辨識。**

最常見的原因就是**沒認出 access token 在 `key` 欄位**。用文字編輯器打開來源檔看一眼，確認：

- 是不是 `{ "auth": { ... } }` 這種形狀
- token 是放在 `key` 還是 `access_token`
- 有沒有 `refresh_token`（**只有 access token 沒有 refresh token 也會全部被丟掉**）

---

## 安全護欄

| 護欄 | 行為 | 實作位置 |
|---|---|---|
| 不寫入來源 | 絕不寫進 `--input` 目錄，一律寫 `--outdir` | `main()` 所有 `writeJson()` 都以 `a.outdir` 為根 |
| 不搬敏感欄位 | `password` / `sso` / `session_cookies` 都不會出現在輸出 | `toCpa()` / `toSub2api()` 用白名單 |
| 不外洩 token | 報告只有數量、路徑、參數，沒有 token 值 | `report` 物件 |
| 參數防呆 | 未知參數直接中止，**不建立空目錄** | `parseArgs()` 的 `default: throw` |
| 檔名消毒 | 非法字元換成底線 | `safeName()` |
| 不吃自己的清單檔 | 跳過 `manifest.json` / `SHA256SUMS` | `loadInput()` |
| 每帳號獨立 header | `Object.assign({}, ...)` 淺拷貝 | `toCpa()` |
| 版控隔離 | `.gitignore` 已排除 `out/`、`cpa/`、`sub2api/`、`xai-*.json` 等輸出 | `.gitignore` |
| 不連網 | 整支腳本沒有任何網路呼叫 | — |

### ⚠️ refresh token 是單一持有者

這是很多人吃過的苦頭，一定要理解：

```text
同一份 refresh token
        │
        ├──► CPA      用它換新 token → 舊的作廢
        │
        └──► Sub2API  用舊的去換 → invalid_grant ❌
```

同一個帳號**同時**匯入 CPA 與 Sub2API，其中一邊遲早會開始回：

```text
invalid_grant / Refresh token has been revoked
```

**請保持部署互斥**：一個帳號只在一個地方跑。用 `--exclude-emails` 維持。

### ⚠️ 轉檔成功 ≠ 有額度

轉檔只保證**格式正確**。帳號本身仍可能回：

| 錯誤 | 意思 | 跟轉檔有關嗎 |
|---|---|---|
| `402 personal-team-blocked:spending-limit` | 該 team 的消費上限到了 | ❌ 無關 |
| `429 free-usage-exhausted` | 免費滾動額度用完 | ❌ 無關 |
| `401 Invalid or expired credentials` | token 真的失效了 | ❌ 無關（需要重新授權） |
| `invalid_grant` | refresh token 被撤銷 | ⚠️ 可能是兩邊同時持有造成 |

**格式對，不代表帳號能用。這是兩件事。**

---

## 常見錯誤排查

| 現象 | 原因 | 處理 |
|---|---|---|
| `unknown argument: --xxx` | 參數拼錯 | 對照[參數說明](#參數說明)，注意都是小寫加兩個減號 |
| `--input is required` | 少了必填參數 | 補上 `--input` |
| `--outdir is required` | 少了必填參數 | 補上 `--outdir` |
| `--target must be cpa\|sub2api\|both` | 值拼錯或大寫 | 用小寫合法值 |
| `--mode must be merged\|split\|both` | 同上 | 用小寫合法值 |
| `ENOENT: no such file or directory` | `--input` 路徑不存在 | 檢查路徑，Windows 路徑有空白要加引號 |
| 轉換數為 0，`skipped.incomplete` 很大 | 來源缺 access / refresh token；或格式未被辨識 | **確認 access token 是否在 `key` 欄位**；確認有 `refresh_token` |
| `source_records_seen` 是 0 | 檔案空的、路徑指錯、或副檔名不是 json/jsonl/txt | 確認副檔名；確認不是只有 `manifest.json` |
| CPA 匯入失敗 | 誤用了 merged 彙總檔 | 改用 `cpa/per-account/xai-<email>.json` |
| Sub2API 匯入失敗 | 丟了 CPA 檔或裸陣列 | 用 `sub2api-<label>-all-<N>.json` |
| CPA 匯入成功但呼叫失敗 | 少了 `X-XAI-Token-Auth` header | 確認檔案是本工具產的，不是手改的 |
| 匯入後 `invalid_grant` | 同一帳號被兩套環境同時持有 | 一邊停用，並用 `--exclude-emails` 隔離 |
| `Buffer.from(...) base64url` 相關錯誤 | Node 版本太舊 | 升級到 Node 18+ |
| 時間欄位是空字串 | 來源沒有時間資訊，JWT 也解不出 | 檢查 `access_token` 是否真的是 JWT（有兩個點） |

### 「跑完了但匯入還是失敗」怎麼查

```text
1. 你要匯到哪裡？
     ├─ CPA     → 檔案應該是 cpa/per-account/xai-<email>.json
     │             ✗ 用了 cpa-xai-merged-N.json → 換檔案，那個不能匯入
     └─ Sub2API → 檔案應該是 sub2api-<label>-all-N.json
                   ✗ 用了 CPA 檔 → 換檔案

2. 打開檔案，頂層是 { } 還是 [ ] ？
     └─ 是 [ ] → 不對。兩種格式的頂層都是物件

3. CPA 檔裡有這三個嗎？
     type: "xai" / base_url / headers["X-XAI-Token-Auth"]
     └─ 缺 → 這個檔案不是本工具產的，重跑一次

4. Sub2API 檔頂層有 "type": "sub2api-data" 嗎？
   accounts[].platform 是 "grok" 嗎？
     └─ 否 → 同上，重跑

5. expires_at / expired 的時間已經過去了嗎？
     └─ 是 → 正常。只要 refresh_token 有效，
             匯入後會自動續期。這不是轉檔問題

6. 匯入成功但呼叫回 402 / 429 ？
     └─ 帳號本身沒額度，跟轉檔無關

7. 匯入成功但回 invalid_grant ？
     └─ 這個帳號的 refresh token 已經被別的環境用掉了
         → 檢查是不是同時部署在兩邊
```

---

## 驗證清單

轉檔完成後，建議逐項確認：

1. **數量對得上**：`accounts_converted` 與預期一致，`skipped` 各項都能解釋（用[上面的算式](#先做一個算式檢查)）
2. **JSON 合法**：
   ```bash
   node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('ok')" ./converted/sub2api/sub2api-xai-all-115.json
   ```
3. **email 集合完全相同**：與來源比對，沒有漏、沒有多
4. **CPA 形狀正確**：per-account 檔含 `type: "xai"`、`base_url`、`headers["X-XAI-Token-Auth"]`
5. **Sub2API 形狀正確**：頂層是 `sub2api-data` **物件**，`accounts[].platform == "grok"`
6. **時間精度正確**：CPA 的 `expired` **沒有**毫秒，Sub2API 的 `expires_at` **有**毫秒
7. **敏感欄位不存在**：輸出中搜尋 `password` / `sso` / `session_cookies`，應該找不到
8. **先試單筆**：兩邊都先匯一個帳號，成功再批量

---

## 手動整理 vs 用這支腳本

| 項目 | 手動 | 本腳本 |
|---|---|---|
| 200 個帳號耗時 | 數小時 | 數秒 |
| 認出 access token 在 `key` | 要先發現這件事 | 自動 |
| 兩種時間精度 | 容易寫成一樣 | 自動分開 |
| 從 JWT 挖 scope / client_id / team_id | 要貼到 Base64 解碼網站 200 次 | 自動，且**不連網** |
| 組 `account_id` | 容易忘記兩個冒號 | 自動 |
| 補 `X-XAI-Token-Auth` header | 很容易漏，而且漏了不會報錯 | 自動 |
| `user_id` / `sub` 要填兩份 | 不知道要這樣做 | 自動 |
| 去重 | 眼睛看 | 自動，用 `account_id` |
| 排除已部署帳號 | 手動比對清單 | `--exclude-emails` |
| 敏感欄位外洩風險 | 高（複製貼上時容易帶到） | 低（白名單） |
| 結果可重現 | 否 | 是 |
| 出錯時知道原因 | 不知道 | 報告的 `skipped` 分類 |

---

## 名詞表

| 名詞 | 一句話解釋 |
|---|---|
| **xAI** | Grok 背後的公司，也是發放 token 的機關 |
| **Grok** | xAI 的 AI 模型 |
| **grokcli-2api** | 管理 Grok 帳號的工具，本專案的主要**來源** |
| **CPA / CLIProxyAPI** | 代理工具，本專案的**目的地一** |
| **Sub2API** | 代理工具，本專案的**目的地二** |
| **auth** | authorization / authentication 的簡稱，泛指「登入憑證」 |
| **token** | 權杖，臨時通行證 |
| **access_token** | 門票。呼叫 API 時出示 |
| **refresh_token** | 換票券。門票過期時換新的。**單一持有者** |
| **id_token** | 身分證。記載你是誰 |
| **JWT** | JSON Web Token，一種 token 格式，中間段可直接解出內容 |
| **claim** | JWT payload 裡的一個欄位 |
| **Base64 / Base64URL** | 一種編碼方式，**不是加密**，任何人可還原 |
| **Unix 時間戳** | 從 1970-01-01 起算的秒數（或毫秒數） |
| **RFC3339** | 時間字串標準格式，本專案要分「含毫秒」和「不含毫秒」 |
| **OAuth** | 一套「不給密碼也能授權」的標準流程 |
| **issuer** | 發證機關，本專案固定 `https://auth.x.ai` |
| **client_id** | 應用程式的身分證號 |
| **scope** | token 的權限清單 |
| **principal_id** | 使用者本人的唯一 ID |
| **team_id** | 帳號所屬團隊（可空） |
| **account_id** | `<issuer>::<principal_id>` 複合 ID |
| **JSON** | 用文字描述資料的格式 |
| **JSONL** | 一行一個 JSON 物件的檔案 |
| **BOM** | 檔案開頭看不見的標記位元組，要砍掉才能 parse |
| **canonical model** | 中間格式，所有輸入先轉成它，再轉成各種輸出 |
| **遞迴** | 函式呼叫自己，用來處理不確定深度的巢狀結構 |
| **Set** | 不重複集合，查詢是 O(1) |
| **白名單 / 黑名單** | 白名單=只允許列出的；黑名單=只擋列出的。安全上白名單較好 |
| **淺拷貝** | 複製物件的第一層，避免多個地方共用同一個物件 |
| **stdout / stderr** | 標準輸出 / 標準錯誤，兩條不同的輸出管道 |
| **round-trip** | 來回轉換，A→B 之後還能 B→A |

---

## 作為 Codex 技能安裝

把整個 repo 放到技能目錄，Codex / Claude 就能自動載入：

```text
<你的技能根目錄>/xai-cpa-sub2api-convert/
├── SKILL.md                       ← AI 讀這個決定何時使用
├── agents/openai.yaml             ← 技能中介資料
└── scripts/convert_xai_auth.mjs   ← 實際執行的腳本
```

之後你就可以直接用自然語言下指令。觸發語句範例：

- 「把這批 Grok 帳號轉成 CPA 可匯入的檔案」
- 「幫我做一份 Sub2API 批量匯入檔，排除已經在 CPA 的帳號」
- 「這個 grokcli-2api 匯出檔轉成一帳號一檔」
- 「把這個 CPA auth 檔轉回 Sub2API 格式」

AI 會自己判斷該用什麼 `--target` / `--mode` 組合、要不要加 `--exclude-emails`。

---

## 版本控制

- 版本號記錄於 [`VERSION`](VERSION)
- 變更歷史記錄於 [`CHANGELOG.md`](CHANGELOG.md)
- 遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)：`MAJOR.MINOR.PATCH`

| 位置 | 什麼時候加 | 對使用者的影響 |
|---|---|---|
| **MAJOR** | CPA 或 Sub2API 輸出形狀變更 | ⚠️ 會破壞既有匯入流程，升級前要看 CHANGELOG |
| **MINOR** | 新增輸入形狀、新增參數 | 向下相容，舊指令照樣能跑 |
| **PATCH** | 修錯字、修邊界行為 | 無感升級 |

目前版本：**1.0.0**

---

## 授權

[MIT](LICENSE)
