# xAI → CPA / Sub2API Converter

[繁體中文](README.md) ｜ **简体中文** ｜ [English](README.en.md)

🌐 **在线转换页（不用安装、数据不离开浏览器）**：<https://amanchang.github.io/xai-cpa-sub2api-convert/>

![version](https://img.shields.io/badge/version-1.1.0-blue)
![node](https://img.shields.io/badge/node-18%2B-339933)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-green)

把 **xAI / Grok** 的账号授权（auth）导出档，转成两种“实测可以直接导入”的格式：

1. **CPA（CLIProxyAPI）** 的 xAI OAuth auth 档
2. **Sub2API** 的导入 payload（`sub2api-data`）

这是一个 **Codex / Claude 技能包（Skill）**，同时也是一支可以单独执行的 Node 脚本。**零第三方依赖**，只要有 Node 18 以上就能跑，而且**不会改动你的源文件**。

> 📖 **这份 README 是写给完全的新手看的。**
> 不会假设你懂 OAuth、JWT、RFC3339、递归。所有名词都会先解释，程序的每一层逻辑也都会用白话讲一遍，并附上源代码片段对照。
> 如果你只想赶快跑起来，直接跳到 [30 秒上手](#30-秒上手)。

---

## 目录

- [先看这个：这工具到底在做什么](#先看这个这工具到底在做什么)
- [名词先讲清楚（新手必读）](#名词先讲清楚新手必读)
- [为什么需要这支工具](#为什么需要这支工具)
- [不要用错技能](#不要用错技能)
- [30 秒上手](#30-秒上手)
- [安装](#安装)
- [完整流程图](#完整流程图)
- [程序逻辑逐段讲解](#程序逻辑逐段讲解)
  - [设计构思：为什么要有“中间格式”](#设计构思为什么要有中间格式)
  - [第 1 步：把文件读进来（读取层）](#第-1-步把文件读进来读取层)
  - [第 2 步：在任意嵌套里挖出账号（辨识层）](#第-2-步在任意嵌套里挖出账号辨识层)
  - [第 3 步：凑出十三个字段（规范化层）](#第-3-步凑出十三个字段规范化层)
  - [第 4 步：过滤管线（筛选层）](#第-4-步过滤管线筛选层)
  - [第 5 步：长成两边要的样子（渲染层）](#第-5-步长成两边要的样子渲染层)
  - [第 6 步：写档与报告（输出层）](#第-6-步写档与报告输出层)
- [支持的输入形状（5 种）](#支持的输入形状5-种)
- [四种输出：两轴交叉出来的](#四种输出两轴交叉出来的)
- [参数说明](#参数说明)
- [输出目录结构](#输出目录结构)
- [导入方式](#导入方式)
- [字段对应表](#字段对应表)
- [执行报告怎么读](#执行报告怎么读)
- [安全护栏](#安全护栏)
- [常见错误排查](#常见错误排查)
- [验证清单](#验证清单)
- [手动整理 vs 用这支脚本](#手动整理-vs-用这支脚本)
- [名词表](#名词表)
- [作为 Codex 技能安装](#作为-codex-技能安装)
- [版本控制](#版本控制)
- [授权](#授权)

---

## 先看这个：这工具到底在做什么

用一个生活化的比喻：

> 你有一叠“账号通行证”，是从一台机器上导出来的。
> 现在你想把这些通行证改放到另外两台机器上使用。
>
> 问题是——这三台机器的**登记簿格式完全不一样**：
>
> - 甲机器把“通行证号码”写在 **key** 这一栏
> - 乙机器要求写在 **access_token** 这一栏，而且时间**不能写到毫秒**
> - 丙机器也要 **access_token**，但时间**一定要写到毫秒**，而且要一次交一大本，不能一张一张交
>
> 这支脚本就是那个**看得懂三种登记簿、帮你重抄一遍**的工人。

换成技术语言：

```text
各种 xAI / Grok 账号导出档  ──►  这支脚本  ──►  ① CPA 能吃的 auth 档（一账号一档）
      （5 种形状）              （统一格式）      ② Sub2API 能吃的 payload（一大包）
```

它**不会**联网、**不会**改你的原始档、**不会**把 token 打印在屏幕上。它只做一件事：**格式转换**。

**它不做的事，也要先讲清楚：**

| 它不会做 | 为什么 |
|---|---|
| 帮你注册新账号 | 它只处理你已经有的导出档 |
| 帮你续期 token | 续期是 CPA / Sub2API 导入后自己去做的 |
| 保证账号有额度 | 额度是账号本身的状态，跟格式无关 |
| 判断账号是不是被停用 | CPA 输出一律写 `disabled: false`，详见[字段对应表](#字段对应表) |

---

## 名词先讲清楚（新手必读）

如果你已经懂这些，可以跳过。

### xAI / Grok / grokcli-2api / CPA / Sub2API 分别是什么

| 名称 | 白话解释 | 在本项目的角色 |
|---|---|---|
| **xAI** | Grok 这个 AI 模型背后的公司 | 发放通行证的单位 |
| **Grok** | xAI 的 AI 模型 | 你最后要用的服务 |
| **grokcli-2api** | 一种管理 Grok 账号的工具，有后台可以导出账号 | **来源**（数据从这里出来） |
| **CPA / CLIProxyAPI** | 一种代理工具，把多个账号轮流拿去用 | **目的地一** |
| **Sub2API** | 另一种代理工具，功能类似 | **目的地二** |

所以整条路是：

```text
grokcli-2api 导出  ──►  本脚本  ──►  CPA 或 Sub2API  ──►  你的程序呼叫 Grok
   （来源）            （转换）        （目的地）
```

### JSON 是什么

一种用文字描述数据的格式，长这样：

```json
{
  "email": "user@example.com",
  "type": "xai"
}
```

大括号 `{}` 包起来的叫“对象”（object），中括号 `[]` 包起来的叫“数组”（array，就是清单）。

**嵌套（nested）** 就是对象里面还有对象：

```json
{
  "accounts": [
    { "name": "a@example.com", "credentials": { "access_token": "..." } }
  ]
}
```

这里 `access_token` 藏在三层里面：`accounts` → `[0]` → `credentials`。本脚本很大一部分的工作就是**在任意深度的嵌套里把账号挖出来**。

### token 是什么

**token（令牌）** 就是“临时通行证”。你登入一次，系统发给你一张通行证，之后你拿这张证去用服务，不用每次重新输入密码。

这个项目会碰到三种：

| 名称 | 白话解释 | 会过期吗 | 本脚本是否必需 |
|---|---|---|---|
| `access_token` | **门票**。每次呼叫 API 都要出示它 | 会，通常几小时 | ✅ **必需** |
| `refresh_token` | **换票券**。门票过期时，用它去换一张新门票 | 很久才过期 | ✅ **必需** |
| `id_token` | **身份证**。里面写着“你是谁”（email、名字） | 会 | ❌ 可有可无 |

> ⚠️ 这三个都是敏感信息，等同于你的账号密码。**不要贴到公开的地方**（GitHub issue、聊天群、论坛）。

**为什么 `refresh_token` 是必需的？** 因为 `access_token` 几小时就过期。如果只给门票不给换票券，账号汇进去几小时后就变废的。所以本脚本的 `isUsable()` 检查会**强制要求两者都有**，缺一个就整笔丢掉。

### JWT 是什么（为什么脚本能“解出”时间、email、team）

`access_token` 通常是 **JWT** 格式。它其实是三段用点 `.` 隔开的字符串：

```text
eyJhbGciOi....  .  eyJzdWIiOiIxMjM0.... .  SflKxwRJSMeKKF2QT4...
   ↑ header            ↑ payload（重点）        ↑ signature 签章
   说明用什么算法      真正的数据在这           防篡改用
```

**中间那段 payload 是 Base64 编码的 JSON**，也就是说——**任何人都可以直接读出来，不需要密码**。

xAI 的 access token payload 里常见的字段：

| 字段 | 意思 | 本脚本拿它做什么 |
|---|---|---|
| `iat` | issued at，这张票什么时候发的（Unix 时间戳） | 补 `last_refresh` |
| `exp` | expires，这张票什么时候过期（Unix 时间戳） | 补 `expires_at` |
| `sub` | subject，使用者的唯一 ID | 补 `principal_id` |
| `principal_id` | xAI 自订的使用者 ID | 补 `principal_id` |
| `team_id` | 这个账号属于哪个 team | 补 `team_id` |
| `client_id` | 是哪个应用程序申请的这张票 | 补 `client_id` |
| `aud` | audience，这张票是给谁用的 | `client_id` 的备援 |
| `scope` | 这张票的权限范围 | 补 `scope` |
| `email` | 账号 email | 补 `email` |

**这是本项目最关键的设计之一：源文件就算什么都没写，只要有 `access_token`，脚本就能自己把上面这些全部挖出来。** 后面 [第 3 步](#第-3-步凑出十三个字段规范化层) 会详细讲。

> 💡 “Base64 编码”不是加密。它只是把数据换一种写法，方便在网络上传输，**任何人都能还原**。
> 顺带一提，本脚本用的是 `base64url` 这个变体（把 `+` `/` 换成 `-` `_`），这也是为什么需要 **Node 18 以上**——旧版 Node 的 `Buffer.from()` 不支持 `"base64url"` 这个参数。

### Unix 时间戳是什么

一个很大的整数，代表“从 1970 年 1 月 1 日 0 点（UTC）到现在经过几秒”。

例如 `1786291200` 就是 2026 年某个时刻。

**但有个大坑：有些系统用“秒”，有些用“毫秒”。** 毫秒的数字会大 1000 倍。脚本用一个很简单的规则判断：

```js
return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
```

`1e12` 就是 1 兆。**如果数字大于 1 兆，那一定是毫秒**（因为秒数要到西元 33658 年才会破 1 兆），就自动除以 1000 转回秒。

### RFC3339 是什么，为什么毫秒这么重要

**RFC3339** 是一种写时间的标准格式，长这样：

```text
2026-08-08T12:34:56Z          ← 不含毫秒
2026-08-08T12:34:56.789Z      ← 含毫秒（多了 .789）
```

结尾的 `Z` 表示这是 UTC 时间（世界标准时间）。

**这是本项目最容易踩的坑：**

| 目的地 | 要求的格式 | 示例 |
|---|---|---|
| **CPA** | **不含**毫秒 | `2026-08-08T12:34:56Z` |
| **Sub2API** | **含**毫秒 | `2026-08-08T12:34:56.789Z` |

所以脚本里有**两个**格式化函数，不是重复代码，是刻意的：

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

JavaScript 的 `toISOString()` 本来就会带毫秒，所以 `toIsoMs()` 直接用；`toIso()` 则用正规表达式把 `.789Z` 换成 `Z` 砍掉毫秒。

> 这两个格式是**实测比对过可以成功导入的文件**得出来的结论，不是猜的。如果你把它们对调，其中一边的导入可能会失败或时间判读错误。

### JSONL 是什么

**JSON Lines**。就是“一行一个 JSON 对象”的文件，行与行之间**没有**逗号、整个文件**没有**外层中括号：

```text
{"email":"a@example.com","access_token":"..."}
{"email":"b@example.com","access_token":"..."}
```

好处是可以一行一行读，不用整个文件载入内存。很多工具导出大量数据时会用这种格式。

### OAuth 相关名词

| 名词 | 白话解释 |
|---|---|
| **OAuth** | 一套“不给密码也能授权”的标准流程 |
| **issuer** | 发证机关。本项目固定是 `https://auth.x.ai` |
| **client_id** | 应用程序的身份证号。哪个 App 来要票，就填哪个 |
| **scope** | 这张票的权限清单，例如“可以读 email”“可以用 grok-cli” |
| **principal_id** | 使用者本人的唯一 ID |
| **team_id** | 这个账号属于哪个团队（不是每个账号都有） |
| **account_id** | 本项目组出来的复合 ID，格式是 `<issuer>::<principal_id>` |

**`account_id` 为什么要这样组？** 因为同一个 `principal_id` 理论上可能出现在不同的发证机关下。把 issuer 也写进去，才能保证全世界唯一。CPA 就是用这个格式当账号的主键：

```text
https://auth.x.ai::0552a0b9-953e-43ce-bd11-9eb435cec24a
└──── issuer ────┘└─────────── principal_id ───────────┘
                 ↑ 两个冒号
```

---

## 为什么需要这支工具

xAI / Grok 账号在不同工具之间的存放格式差异很大。以下是**手动改档一定会踩到**的坑，按严重程度排序。

### 坑 1：access token 藏在 `key` 字段（最容易漏）

grokcli-2api 的 admin 导出长这样：

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

注意：**access token 在 `key` 这一栏，不是 `access_token`**。

如果你写程序只去找 `access_token`，会拿到空字符串，然后批量账号都被判定为“不完整”而丢掉。这是本工具最重要的一条兼容规则：

```js
const access =
  src.access_token || src.accessToken || src.key || src.token ||
  (src.credentials && src.credentials.access_token) || "";
```

一次试五个位置，哪个有值就用哪个。

### 坑 2：时间格式精度不同

上面 [RFC3339](#rfc3339-是什么为什么毫秒这么重要) 已经讲过：CPA 不要毫秒，Sub2API 要毫秒。手动改档时很容易两边写成一样，导致其中一边出问题。

### 坑 3：导入单位不同

| 目的地 | 导入单位 | 意思 |
|---|---|---|
| **CPA** | **一账号一档** | 200 个账号要上传 200 次 |
| **Sub2API** | **一个大 payload** | 200 个账号放在一个文件里，上传 1 次 |

这两种需求完全相反，所以本脚本要能**同时产出两种**。这也是为什么有 `--mode` 这个参数（详见[四种输出](#四种输出两轴交叉出来的)）。

### 坑 4：有些字段只存在 JWT 里

`scope`、`client_id`、`team_id`、`principal_id` 这几个字段，源文件常常**根本没写**，只藏在 `access_token` 的 JWT payload 里面。

手动处理的话，你得：

1. 把 token 复制到 Base64 解码网站
2. 贴上、解码、看 JSON
3. 找出字段、抄回你的文件
4. **重复 200 次**

而且把 token 贴到第三方网站本身就是资安风险。脚本在本机就做完了，不联网。

### 坑 5：CPA 需要特殊 header

CPA 呼叫 xAI 时，必须带一个自订的 HTTP header：

```json
"headers": { "X-XAI-Token-Auth": "xai-grok-cli" }
```

少了它，CPA 导入不会报错，但**实际呼叫会失败**。这是最难查的那种错误——格式看起来都对，就是不能用。脚本会自动补上。

---

## 不要用错技能

> ❌ **不要**用 `sub2api-auth-converter` 处理 xAI / Grok 账号。
>
> 那支工具的目标是 Codex / OpenAI 风格的 auth，它的中间格式里**没有** `team_id`、`principal_id`、`X-XAI-Token-Auth`、xAI 的 `base_url` 这些字段。用它转出来的文件，这些字段会全部消失，导入 CPA 之后呼叫一定失败。
>
> ✅ xAI / Grok 请用本项目。

简单判断法：

```text
你的账号是哪一家的？
  │
  ├─ OpenAI / Codex（有 chatgpt_account_id）  ──►  用 sub2api-auth-converter
  │
  └─ xAI / Grok（有 key 或 auth.x.ai）        ──►  用本项目
```

---

## 30 秒上手

### 情境一：我什么都要，一次全部产出

```bash
node scripts/convert_xai_auth.mjs \
  --input  ./my-grok-export \
  --outdir ./converted \
  --target both \
  --mode   both \
  --label  batch01
```

会在 `./converted/` 底下同时产出 CPA 和 Sub2API 两种格式、汇总和单账号两种模式。**第一次用建议就下这个**，四种都看一眼再决定要哪个。

### 情境二：我只要 CPA，而且要一账号一档

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./converted \
  --target cpa --mode split
```

产出 `./converted/cpa/per-account/xai-<email>.json`，这些就是 CPA 实际要上传的文件。

### 情境三：我要 Sub2API 批量档，但要排除已经部署在 CPA 的账号

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./converted \
  --target sub2api --mode merged \
  --exclude-emails ./already-deployed.txt
```

`already-deployed.txt` 就是一行一个 email 的纯文字档。**这一步非常重要**，原因见[安全护栏](#安全护栏)里的 refresh token 说明。

### 情境四：我只想先测 3 个账号

```bash
node scripts/convert_xai_auth.mjs \
  --input ./my-grok-export --outdir ./test-out \
  --limit 3
```

> **Windows PowerShell 使用者注意**
>
> 1. PowerShell 的换行符号是反引号，不是 `\`。最简单的做法是**全部写成一行**
> 2. `node` 没有的话先去 [nodejs.org](https://nodejs.org/) 装 LTS 版
> 3. 路径有空白要用引号包起来

---

## 安装

需求：**Node 18 或以上**（因为用到 `Buffer.from(..., "base64url")`）。**不需要** `npm install` 任何套件。

### 步骤 1：确认 Node 版本

```bash
node --version
```

要看到 `v18.x.x` 或更高。如果是 `v16` 或更旧，`base64url` 解不出来，JWT 挖不到东西。

### 步骤 2：下载

```bash
git clone https://github.com/amanchang/xai-cpa-sub2api-convert.git
cd xai-cpa-sub2api-convert
```

### 步骤 3：确认能跑

```bash
node scripts/convert_xai_auth.mjs
```

会看到：

```text
Error: --input is required
```

**看到这个错误代表安装成功。** 它在告诉你缺参数，不是坏了。

---
## 完整流程图

先看整张图有个印象，下一节会把每一层用白话讲一遍。图上每个方块都标了对应的“层”名称。

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
                    |            loadInput()            |  <-- 读取层
                    |  folder: *.json *.jsonl *.txt     |
                    |  skips manifest.json / SHA256SUMS |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                    |   extractRecords()   (递归扫描)    |  <-- 辨识层
                    |   auth{} / accounts[] /           |
                    |   credentials{} / flat object     |
                    +-----------------+-----------------+
                                      |
                                      v
                    +-----------------------------------+
                    |          canonicalize()           |  <-- 规范化层
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
                    |        filter pipeline            |  <-- 筛选层
                    |  isUsable()  -> skipped.incomplete|
                    |  dedupe      -> skipped.duplicate |
                    |  --exclude-emails -> .excluded    |
                    |  --skip-expired   -> .expired     |
                    |  --limit N   -> slice(0, N)       |
                    +--------+---------------+----------+
                             |               |
             --target cpa    |               |    --target sub2api
                             v               v
              <-- 渲染层 -->                <-- 渲染层 -->
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
             |  stdout: JSON report          <-- 输出层     |
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

看不懂没关系，**下一节会把每一层拆开来讲，并贴上对应的源代码**。

---

## 程序逻辑逐段讲解

这一节是本 README 的核心。看完你应该能**自己改这支脚本**。

脚本只有一个文件：`scripts/convert_xai_auth.mjs`，约 380 行，分成六层：

| 层 | 主要函数 | 一句话职责 |
|---|---|---|
| **读取层** | `loadInput()` / `loadFile()` | 把文件（或整个文件夹）的文字读进来，变成 JSON |
| **辨识层** | `extractRecords()` | 在任意嵌套结构里把“账号”挖出来 |
| **规范化层** | `canonicalize()` | 把五花八门的字段名，统一成 13 个固定字段 |
| **筛选层** | `main()` 里的过滤管线 | 丢掉不完整、重复、被排除、已过期的 |
| **渲染层** | `toCpa()` / `toSub2api()` | 把统一格式，长成两边各自要的样子 |
| **输出层** | `writeJson()` + 报告 | 写档、产 manifest、印报告 |

### 设计构思：为什么要有“中间格式”

最直觉的写法是：**遇到什么格式，就写一段程序把它直接转成目标格式**。

```text
❌ 直接转（N × M 条路）

grokcli admin  ──► CPA        grokcli admin  ──► Sub2API
grokcli native ──► CPA        grokcli native ──► Sub2API
CPA 档          ──► CPA        CPA 档          ──► Sub2API
Sub2API 档      ──► CPA        Sub2API 档      ──► Sub2API
JSONL          ──► CPA        JSONL          ──► Sub2API

→ 5 种输入 × 2 种输出 = 10 段转换程序
→ “email 要去哪里找”这个规则，要写 10 次
→ 改一个字段规则，要同时改 10 个地方，漏一个就出 bug
```

这样写，未来每多一种输入格式、或多一种输出目标，代码就爆炸成长。

本项目采用的是**中间格式（canonical model）** 的做法：

```text
✅ 经过中间格式（N + M 条路）

grokcli admin  ─┐
grokcli native ─┤
CPA 档          ─┼──► 【13 个标准字段】 ─┬──► toCpa()      ──► CPA 档
Sub2API 档      ─┤       中间格式         └──► toSub2api()  ──► Sub2API payload
JSONL / 文字    ─┘

→ 5 段读取 + 2 段渲染 = 7 段程序
→ 字段规则只有一个地方（canonicalize）
→ 未来要加第三个目的地，只要多写一个 toXxx()
```

**中间格式就是 `canonicalize()` 返回的那个对象**，13 个字段：

```js
return {
  email,                    // 账号 email
  access_token: access,     // 门票（必需）
  refresh_token: refresh,   // 换票券（必需）
  id_token: idToken,        // 身份证（可空）
  token_type: ...,          // 固定 "Bearer"
  scope: ...,               // 权限范围
  client_id: ...,           // 应用程序 ID
  principal_id: principal,  // 使用者 ID
  team_id: ...,             // 团队 ID（可空）
  account_id: accountId,    // issuer::principal_id
  expires_at: expEpoch,     // 过期时间（Unix 秒）
  last_refresh: iatEpoch,   // 发证时间（Unix 秒）
  disabled: src.disabled === true,
  source_disabled_reason: ...,
};
```

**注意这里的时间是“Unix 秒”，不是字符串。** 这是刻意的设计：

```text
来源（各种格式）──► 中间格式（统一用 Unix 秒）──► 渲染层（各自转成字符串）
   毫秒 / 秒 /                    ↑                    ├─ toIso()   → 不含毫秒（CPA）
   ISO 字符串 / JWT exp        统一在这里              └─ toIsoMs() → 含毫秒（Sub2API）
```

**为什么中间格式要存数字而不是字符串？** 因为数字才好比较。筛选层要判断“这个 token 过期了吗”，用 `r.expires_at <= nowEpoch` 一行就搞定；如果存字符串，每次比较都要重新 parse。**该做格式化的时候再格式化**，这是一条通用原则。

这个模式在软件设计上很常见，有时叫 **Hub-and-Spoke（轴辐式）**，有时叫 **Canonical Data Model**。你在写任何“多对多转换”的程序时都可以套用。

---

### 第 1 步：把文件读进来（读取层）

**负责的函数**：`loadInput()` → `loadFile()`

#### 白话说明

你给 `--input` 一个路径，它可能是：

- **一个文件夹** → 要把里面每个相关文件都扫一遍
- **一个文件** → 直接处理它

#### `loadInput()` 的逻辑

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

| 这行在做什么 | 为什么要这样做 |
|---|---|
| `fs.statSync(input)` | 问操作系统“这个路径是文件还是文件夹” |
| `.filter(/\.(json\|jsonl\|txt)$/i)` | 只要这三种副文件名。`/i` 表示不分大小写，所以 `.JSON` 也吃 |
| 排除 `manifest.json` | **那是本工具自己产生的清单档**，里面没有账号 |
| 排除 `sha256sums` | 那是校验档，不是数据 |
| `.sort()` | **让结果可重现**。不排序的话，文件系统返回顺序可能每次不同，导致去重时“谁先被留下”不固定 |
| `out` 用参数传进去 | 这叫 **accumulator（累加器）模式**，所有递归呼叫共用同一个数组，不用一直合并 |

#### 为什么要排除 `manifest.json`（新手最常踩的坑）

假设你第一次跑完，输出目录长这样：

```text
converted/cpa/
├── manifest.json          ← 本工具产的清单
└── per-account/
    ├── xai-a@example.com.json
    └── xai-b@example.com.json
```

如果你第二次把 `converted/cpa/` 当成 `--input`（想做 round-trip 转成 Sub2API），没有排除规则的话，`manifest.json` 也会被读进来。它里面没有 token，会被判定为“不完整”，让 `skipped.incomplete` 多一笔，让你以为有账号漏掉了。

**这条规则不是洁癖，是避免“自己吃自己的输出”造成误报。**

#### `loadFile()`：怎么判断文件格式

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
    extractRecords(JSON.parse(raw), hint, out);   // 先试整档
    return;
  } catch {}

  // 整档失败 → 降级为“一行一个 JSON”
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] !== "{") continue;
    try { extractRecords(JSON.parse(s), hint, out); } catch {}
  }
}
```

三个重点：

**① `replace(/^\uFEFF/, "")` 是在干嘛？**

有些 Windows 程序存 UTF-8 文件时，会在开头偷偷塞一个看不见的字元（叫 **BOM**，Byte Order Mark，代码是 `U+FEFF`）。你用文字编辑器看不出来，但 `JSON.parse()` 会直接报错说“第 1 个字元不合法”。这行就是把它砍掉。

**② “先试最严格的，失败才降级”**

```text
副文件名是 .jsonl？
  │
  ├─ 是 → 直接逐行解析（因为 JSONL 本来就不是合法的单一 JSON）
  │
  └─ 否 → 试着整档 JSON.parse()
            │
            ├─ 成功 → 交给 extractRecords()
            │
            └─ 失败 → 那大概是“标题行 + 每行一个 JSON”的文字导出
                       → 逐行扫，不是 { 开头的行直接跳过
```

这叫 **sniffing（嗅探）**。好处是：**使用者不用告诉脚本“我这是什么格式”，脚本自己试出来。**

**③ `hint` 是什么，为什么需要它**

```js
const hint = path.basename(file).replace(/^xai-/, "").replace(/\.(json|jsonl|txt)$/i, "");
```

把 `xai-user@example.com.json` 这个文件名，处理成 `user@example.com`。

**为什么？** 因为有些 auth 文件**里面根本没写 email**，email 只存在文件名上。这时候文件名就是最后的线索。`canonicalize()` 取 email 的顺序最后一项就是它：

```js
const email =
  src.email || cred.email || (src.extra && src.extra.email) ||
  pl.email || idpl.email || hintName || "";
//                          ↑ 前面全都没有，才用文件名
```

**④ `catch {}` 为什么吞掉错误？**

```js
try { extractRecords(JSON.parse(s), hint, out); } catch {}
```

因为在逐行扫描的情境下，**遇到一行坏掉的数据，不应该让批量 200 个账号全部失败**。跳过那一行，继续处理其他的，最后从报告里的 `source_records_seen` 数量对不上，你就知道有东西被跳过了。

> 这是一个**刻意的权衡**：容错 vs 明确报错。这里选容错，因为批量处理时“尽量救回能救的”比“全有全无”实用。

---

### 第 2 步：在任意嵌套里挖出账号（辨识层）

**负责的函数**：`extractRecords()`

#### 白话说明

到这一步，你手上有一个已经 parse 好的 JavaScript 对象。但**账号可能藏在任意深度**：

```text
形状 A：{ auth: { "https://auth.x.ai::uuid": { key, refresh_token } } }
                                              ↑ 在这（第 3 层）

形状 B：{ accounts: [ { name, credentials: { access_token } } ] }
                                              ↑ 在这（第 4 层）

形状 C：{ access_token, refresh_token, email }
          ↑ 在这（第 1 层）

形状 D：[ {...}, {...}, {...} ]
            ↑ 数组里每个都是
```

#### 为什么用递归

**如果不用递归**，你得为每种形状写一段 `if`，而且嵌套层数一多就写不完：

```js
// ❌ 这样写会失控
if (obj.auth) { for (...) { if (obj.auth[k].accounts) { for (...) { ... } } } }
```

**用递归的话**，你只需要描述“遇到某种形状时，该往哪里继续找”，剩下的深度问题自动解决：

```js
function extractRecords(node, hintName, out) {
  if (node == null) return;                                    // ① 终止条件

  if (Array.isArray(node)) {                                   // ② 数组 → 每个元素再找
    for (const item of node) extractRecords(item, hintName, out);
    return;
  }
  if (typeof node !== "object") return;                         // ③ 不是对象 → 没东西可找

  // ④ grokcli-2api admin 导出：{ "auth": { "<account_id>": {...} } }
  if (node.auth && typeof node.auth === "object" && !Array.isArray(node.auth)) {
    for (const [k, v] of Object.entries(node.auth)) extractRecords(v, k, out);
    //                                                            ↑ key 当 hint！
    return;
  }

  // ⑤ sub2api-data / CPA 汇总 / grokcli 导出：{ accounts: [...] }
  if (Array.isArray(node.accounts)) {
    for (const item of node.accounts) extractRecords(item, hintName, out);
    return;
  }

  // ⑥ Sub2API 账号对象：credentials 嵌套
  if (node.credentials && typeof node.credentials === "object") {
    const merged = Object.assign({}, node.credentials, {
      email: node.credentials.email || (node.extra && node.extra.email) || node.name,
      disabled: node.disabled,
    });
    out.push(canonicalize(merged, hintName));
    return;
  }

  // ⑦ 平的账号对象（grokcli 原生 xai 档、CPA auth 档、admin auth entry）
  if (node.access_token || node.key || node.refresh_token) {
    out.push(canonicalize(node, hintName));
    return;
  }
}
```

#### 逐条解释

| 编号 | 判断 | 做什么 | 为什么 |
|---|---|---|---|
| ① | `node == null` | 直接返回 | **递归的终止条件**。没有这个会无限循环 |
| ② | 是数组 | 对每个元素再呼叫自己 | 数组本身不是账号，里面的才是 |
| ③ | 不是对象 | 直接返回 | 字符串、数字里面不可能有账号 |
| ④ | 有 `auth` 对象 | 对每个 value 递归，**并把 key 当 hint** | 这是 grokcli-2api 的形状，key 就是 `account_id` |
| ⑤ | 有 `accounts` 数组 | 对每个元素递归 | Sub2API 和 CPA 汇总档都是这形状 |
| ⑥ | 有 `credentials` 对象 | **摊平后**收下 | Sub2API 把 token 包在 `credentials` 里 |
| ⑦ | 有 `access_token` 或 `key` 或 `refresh_token` | 直接收下 | 这是最基本的“平对象”形状 |

**注意每个分支都有 `return`。** 这表示“找到符合的形状就停，不再往下试其他分支”——**先判断的优先**。顺序不能乱改，例如 ⑦ 如果放到 ④ 前面，grokcli admin 导出的外层可能被误判。

#### ④ 为什么要把 key 当 hint（很巧妙的一手）

grokcli-2api 的导出：

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

注意：**`account_id` 是这个对象的 key，不是里面的字段。** 如果不把 key 传下去，这个信息就永远丢了。

所以 `extractRecords(v, k, out)` 把 key 当 `hintName` 传进去。虽然它最后主要用在 email 的备援，但这个“**把外层信息带着往下走**”的手法，是处理嵌套数据时很常用的技巧。

#### ⑥ 为什么要用 `Object.assign()` 摊平

Sub2API 的账号对象长这样：

```json
{
  "name": "user@example.com",
  "platform": "grok",
  "credentials": { "access_token": "...", "refresh_token": "..." },
  "extra": { "email": "user@example.com" },
  "disabled": false
}
```

email 可能出现在**三个地方**：`credentials.email`、`extra.email`、`name`。而 token 在 `credentials` 里面。

```js
const merged = Object.assign({}, node.credentials, {
  email: node.credentials.email || (node.extra && node.extra.email) || node.name,
  disabled: node.disabled,
});
```

意思是：**以 `credentials` 为底，补上从外层捡来的 email 和 disabled**，摊成一个平对象再交给 `canonicalize()`。

这样 `canonicalize()` 就不用知道 Sub2API 的结构长什么样——**复杂度被隔离在辨识层**。

#### 一个附加好处：可以反向 round-trip

因为 ⑤⑥ 认得 Sub2API 的形状、⑦ 认得 CPA 的形状，所以：

```text
Sub2API 档 ──► 本脚本 ──► CPA 档      ✅ 可以
CPA 档     ──► 本脚本 ──► Sub2API 档  ✅ 也可以
```

这**不是刻意设计的功能，是递归 + 中间格式自然带来的副产品**。好的架构常常会这样：你为了 A 目的做的设计，顺便解决了 B 问题。

---
### 第 3 步：凑出十三个字段（规范化层）

**负责的函数**：`canonicalize()`，搭配工具函数 `jwtPayload()`、`toEpoch()`

这是整支脚本**最重要**的一段。所有“兼容性智慧”都集中在这里。

#### 核心手法：`||` 串接

JavaScript 的 `||`（or）运算子有个特性：**返回第一个“有值”的东西**。

```js
const access = src.access_token || src.accessToken || src.key || src.token || "";
```

意思是：先看 `access_token` 有没有值，没有就看 `accessToken`，再没有就看 `key`……全部都没有就给空字符串。

**这一行就取代了一大串 `if / else if`。** 读起来像一份“优先级清单”。

> ⚠️ 小陷阱：`||` 会把 `0`、`""`、`false` 也当成“没有值”。对 token 这种字符串来说没问题（空字符串本来就该跳过），但如果你要处理“数字 0 是合法值”的字段，就得改用 `??`（nullish coalescing）。本脚本的字段都不需要，所以用 `||` 最简洁。

#### 三层解析优先级（设计核心）

每个字段都遵守同一个原则：

```text
① 源文件明确写的字段
        ↓ 没有
② 从 access_token 的 JWT payload 挖出来
        ↓ 没有
③ xAI 文件上的默认值（写死在常数）
```

**为什么是这个顺序？**

| 顺位 | 为什么排这里 |
|---|---|
| ① 来源字段 | **最可信**。工具明确存下来的值，代表它自己确认过 |
| ② JWT claim | **次可信**。是 xAI 签发的，一定正确，但可能不完整 |
| ③ 写死默认 | **最后手段**。至少能让账号跑起来，不会因为缺一个 `scope` 就整笔丢掉 |

实际的常数（写在文件最上面）：

```js
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_ISSUER = "https://auth.x.ai";
const CPA_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const CPA_TOKEN_HEADER = { "X-XAI-Token-Auth": "xai-grok-cli" };
const DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";
```

> 这些都是 **grok-cli 这个官方公开客户端的公开识别值**，不是任何人的私密数据。放在源代码里是安全的。

#### `jwtPayload()`：怎么解 JWT

```js
function jwtPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) return {};
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch { return {}; }
}
```

一步一步：

| 步骤 | 程序 | 说明 |
|---|---|---|
| 1 | `typeof token !== "string"` | 不是字符串就不用试了 |
| 2 | `!token.includes(".")` | 没有点就不是 JWT（可能是 API key 之类） |
| 3 | `token.split(".")[1]` | 用点切三段，取**中间**那段（index 1） |
| 4 | `Buffer.from(..., "base64url")` | Base64URL 解码成字节 |
| 5 | `.toString("utf8")` | 字节变成文字 |
| 6 | `JSON.parse(...)` | 文字变成对象 |
| 7 | `catch { return {} }` | 任何一步失败就返回**空对象** |

**⑦ 为什么返回空对象而不是 `null`？**

因为呼叫端可以直接写 `pl.exp` 而不用先检查：

```js
const pl = jwtPayload(access);   // 保证是对象
const expEpoch = toEpoch(pl.exp) || ...;   // 不会爆
```

如果返回 `null`，每次用都得写 `pl && pl.exp`。**这叫 Null Object Pattern（空对象模式）**：用一个“什么都没有但形状正确”的对象，取代 `null` 检查。

#### `toEpoch()`：吃各种时间格式

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

它能吃四种输入：

| 输入例子 | 走哪条路 | 结果 |
|---|---|---|
| `1786291200`（数字，秒） | 第 2 行 | `1786291200` |
| `1786291200000`（数字，毫秒） | 第 2 行，`> 1e12` 成立 | 除以 1000 → `1786291200` |
| `"1786291200"`（字符串数字） | 第 3-4 行，`Number()` 转成功 | `1786291200` |
| `"2026-08-08T12:00:00Z"`（ISO 字符串） | 最后 `Date.parse()` | `1786291200` |
| `null` / `""` / 乱码 | 各种防守 | `0` |

**返回 `0` 代表“没有”**，因为 `0` 在 `||` 串接里会被当成“没有值”而继续往下找。这让 `toEpoch(a) || toEpoch(b) || toEpoch(c)` 这种写法能自然运作。

#### 每个字段的取得策略

##### access_token（必需）

```js
const access =
  src.access_token || src.accessToken || src.key || src.token ||
  (src.credentials && src.credentials.access_token) || "";
```

五个位置，**`key` 是关键**（grokcli-2api admin 导出用它）。`accessToken` 是驼峰命名的变体，某些工具会这样写。

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

六个位置，优先级是：**来源字段 → 嵌套字段 → access token JWT → id token JWT → 文件名**。

注意这里同时解了两个 JWT：

```js
const pl = jwtPayload(access);     // access token 的 payload
const idpl = jwtPayload(idToken);  // id token 的 payload
```

**为什么要解 id token？** 因为 id token 专门用来描述“你是谁”，email 这种身份信息在里面通常更完整。access token 的重点是权限，不一定有 email。

##### principal_id

```js
const principal =
  src.principal_id || src.user_id || src.sub || pl.principal_id || pl.sub || idpl.sub || "";
```

六个位置。`sub` 是 OAuth 标准里“subject”的字段名，`user_id` 和 `principal_id` 是不同工具的叫法。

##### account_id

```js
const accountId =
  src.account_id || src.id ||
  (principal ? XAI_ISSUER + "::" + principal : "");
```

**如果来源有写就直接用；没有的话，用 `principal_id` 自己组出来。** 这就是 `https://auth.x.ai::<uuid>` 那个格式。

注意 `principal ? ... : ""` ——如果连 `principal_id` 都没有，就回空字符串，不要组出一个 `https://auth.x.ai::` 这种残缺的 ID。

##### expires_at（过期时间）

```js
const expEpoch =
  toEpoch(src.expires_at) || toEpoch(cred.expires_at) || toEpoch(src.expired) ||
  toEpoch(pl.exp) ||
  (src.expires_in && src.last_refresh
    ? toEpoch(src.last_refresh) + Number(src.expires_in) : 0);
```

四层备援，**注意顺序：来源字段排在 JWT `exp` 前面**。源代码里有注释说明原因：

> `// Explicit source expiry wins; grokcli-2api stores the authoritative value and`
> `// it can differ from the JWT exp claim by a second. JWT exp is the fallback.`

翻译：**grokcli-2api 存的过期时间，和 JWT 里的 `exp` 可能差一秒。** 既然来源工具自己记了一份，就以它为准——它比较知道自己的状态。

最后一层 `last_refresh + expires_in` 是**算出来的**：有些格式只记“发证时间”和“几秒后过期”，没有直接记绝对时间。

##### last_refresh（上次刷新时间）

```js
const iatEpoch = toEpoch(pl.iat) || toEpoch(src.last_refresh) || toEpoch(src.create_time);
```

**这里顺序反过来了：JWT `iat` 优先。** 为什么？因为 `iat` 是 xAI 签发时写进 token 的，**就是这张 token 真正的发放时刻**，比来源工具记的“我上次刷新是什么时候”更精确。

> 这两个字段的优先级刻意不同，是因为它们的语意不同：`exp` 是“预测”（会被续期改变），`iat` 是“事实”（已经发生的签发时刻）。

##### scope / client_id / team_id

```js
scope: pl.scope || src.scope || cred.scope || DEFAULT_SCOPE,
client_id: pl.client_id || src.oidc_client_id || src.client_id || cred.client_id || pl.aud || XAI_CLIENT_ID,
team_id: src.team_id || pl.team_id || "",
```

- `scope` 和 `client_id` **JWT 优先**，因为这两个是 xAI 签发时决定的事实
- `client_id` 有一个特别的备援 `pl.aud` ——OAuth 标准里 `aud`（audience）通常就是 client id
- `team_id` **允许空**，因为不是每个账号都属于某个 team

#### 必填字段检查：`isUsable()`

```js
function isUsable(rec) {
  return Boolean(rec.access_token && rec.refresh_token && rec.email);
}
```

只要这三个有任一个缺，整笔就在筛选层被丢掉，计入 `skipped.incomplete`。

**为什么是这三个？**

| 字段 | 为什么非它不可 |
|---|---|
| `access_token` | 没有门票，什么都做不了 |
| `refresh_token` | 没有换票券，几小时后就变废账号，汇进去是浪费 |
| `email` | **文件名和账号辨识都靠它**。CPA 的文件名格式就是 `xai-<email>.json` |

注意 `id_token`、`team_id` **不在必填清单**。它们缺了照样能用。

> 这里展现一个重要的设计判断：**必填清单要“刚好够用”，不能贪心。** 如果把 `team_id` 也列必填，很多本来能用的账号会被误杀。

---

### 第 4 步：过滤管线（筛选层）

**位置**：`main()` 函数里

#### 白话说明

现在你有一大堆规范化好的账号。这一层负责**筛掉不该导出的**，并且**记录每笔是为什么被筛掉**。

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

#### 四道关卡

```text
所有规范化后的账号
      │
      ▼
【关卡 1】isUsable()？          ──否──► skipped.incomplete++
      │是
      ▼
【关卡 2】看过这个 key 了？      ──是──► skipped.duplicate++
      │否
      ▼
【关卡 3】在排除清单里？         ──是──► skipped.excluded++
      │否
      ▼
【关卡 4】--skip-expired 且过期？──是──► skipped.expired++
      │否
      ▼
   收下，记录 key
      │
      ▼
【最后】--limit N ？──► 只留前 N 笔
```

#### 关卡 2 的去重 key 为什么要“退回 email”

```js
const key = (r.account_id || r.email).toLowerCase();
```

**优先用 `account_id`**，因为它才是真正的唯一识别。同一个账号可能在不同导出档里 email 大小写不同，但 `account_id` 一定一样。

**`account_id` 没有时退回 email**，因为总比完全不去重好。

**`.toLowerCase()` 是必要的**：email 在多数系统里不分大小写，`User@Example.com` 和 `user@example.com` 是同一个人。不转小写的话会被当两笔而重复导入。

#### `Set` 是什么

JavaScript 的 `Set` 是“不重复集合”。`seen.has(key)` 查询速度是 **O(1)**（常数时间），跟里面有几笔无关。

如果用数组加 `.includes()`，每次查询是 **O(n)**，1000 笔数据就要比对 1000 次，总共 100 万次比对。**用 Set 是 1000 次。**

> 这是一个很实用的效能常识：**需要反复问“有没有见过这个”，就用 Set 或 Map，不要用数组。**

#### 关卡 3：`--exclude-emails` 为什么存在（重要）

这个参数的存在理由是**避免账号被两边同时持有**。

```text
同一份 refresh token
        │
        ├──► CPA      用它换新 token → 旧的作废
        │
        └──► Sub2API  用旧的去换 → invalid_grant ❌
```

**refresh token 通常是“一次性”的**：用掉一次就换成新的，旧的立刻失效。所以同一个账号同时丢进两套环境，其中一边迟早会拿到：

```text
invalid_grant / Refresh token has been revoked
```

`--exclude-emails` 让你维持**部署互斥**：

```bash
# 第一批 100 个给 CPA
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out-cpa \
  --target cpa --limit 100

# 记下已用掉的 email 到 cpa-used.txt，第二批给 Sub2API 时排除
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out-sub \
  --target sub2api --exclude-emails ./cpa-used.txt
```

参数本身支持**两种写法**，程序会自己判断：

```js
if (fs.existsSync(a.excludeEmails)) {
  // 是文件 → 一行一个 email
  for (const line of fs.readFileSync(a.excludeEmails, "utf8").split(/\r?\n/)) {
    const s = line.trim(); if (s) exclude.add(s.toLowerCase());
  }
} else {
  // 不是文件 → 当成逗号分隔清单
  for (const s of a.excludeEmails.split(",")) if (s.trim()) exclude.add(s.trim().toLowerCase());
}
```

**先检查是不是文件，不是就当清单。** 这种“一个参数两种用法”的设计，对只想排除两三个 email 的人很方便，不用特地开一个文件。

#### 关卡 4：为什么过期不是默认筛掉

```js
if (a.skipExpired && r.expires_at && r.expires_at <= nowEpoch) { ... }
```

注意要**明确加 `--skip-expired`** 才会生效。默认是**不筛掉**。

**为什么？** 因为 `access_token` 过期是**正常状态**，而且**可以救**：只要 `refresh_token` 还有效，CPA / Sub2API 导入后会自动用它换一张新门票。

如果默认筛掉，你会白白丢掉一大批其实可用的账号。

所以报告里 `warnings.access_token_already_expired` 是**警告，不是错误**：

```text
warnings.access_token_already_expired: 4
   ↑ 这 4 个账号的门票过期了，但还是会被导出
     导入后会自动用 refresh token 续期
```

---
### 第 5 步：长成两边要的样子（渲染层）

**负责的函数**：`toCpa()`、`toSub2api()`

到这一步，数据已经完全统一。渲染层的工作很单纯：**照着目标格式排列字段**。

#### `toCpa()`：CPA 要的形状

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

几个要注意的点：

**① 字段名改掉了**

| 中间格式 | CPA 叫法 |
|---|---|
| `expires_at` | `expired` |
| `principal_id` | `user_id` **和** `sub`（同一个值写两个字段！） |
| `client_id` | `oidc_client_id` |

**`user_id` 和 `sub` 为什么要写两份同样的值？** 因为 CPA 内部不同程序路径会读不同字段。两个都填是最保险的做法——这是实测得出的结论，不是理论。

**② `Object.assign({}, CPA_TOKEN_HEADER)` 为什么不直接用常数**

```js
headers: Object.assign({}, CPA_TOKEN_HEADER),   // ✅
headers: CPA_TOKEN_HEADER,                       // ❌ 危险
```

如果直接写 `CPA_TOKEN_HEADER`，那 **200 个账号的 `headers` 会全部指向同一个对象**。以后任何人改了其中一个账号的 header，另外 199 个会一起被改。

`Object.assign({}, x)` 是**浅拷贝**，每个账号拿到自己的副本。

> 这是 JavaScript 新手最常见的 bug 来源之一：**对象是“参考传递”，不是复制。** 要复制得明确写出来。

**③ `disabled: false` 一律写死**

```js
disabled: false,
```

即使中间格式里有 `rec.disabled`（来源池标记为停用），输出**还是写 `false`**。

**为什么这样设计？** 因为“在来源池被停用”和“在目标池要不要启用”是**两件不同的事**。你可能就是因为某账号在 A 机器被停用，才要把它搬到 B 机器。如果转换时自动帮你停用，你反而得手动去后台一个一个开。

**但这是一个需要你知道的行为**：如果你的来源池有一堆刻意停用的死账号，它们也会被导出成启用状态。要避免的话，去来源池先确认状态，或用 `--exclude-emails` 排除。

#### `toSub2api()`：Sub2API 要的形状

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

差异对照：

| 项目 | CPA | Sub2API |
|---|---|---|
| **结构** | 平的 | token 包在 `credentials` 里 |
| **时间** | `toIso()` 不含毫秒 | `toIsoMs()` **含**毫秒 |
| **email 位置** | `email` | `name`、`credentials.email`、`extra.email`（三个地方！） |
| **base_url** | 常数写死 | 参数可覆写（`--sub2api-base-url`） |
| **有排程字段** | 没有 | `concurrency`、`priority`、`rate_multiplier` |
| **不需要的字段** | — | 没有 `team_id`、`scope`、`principal_id` |

**email 为什么要写三个地方？** 同样是实测结论：Sub2API 后台的清单显示读 `name`，额度查询读 `credentials.email`，内部标签读 `extra.email`。三个都填才不会有地方显示空白。

**`concurrency: 1` 为什么是 1 而不是 10？** 因为 Grok 免费账号的额度很有限（单账号约 1M tokens 的滚动额度）。设 1 是保守值，避免同一账号被同时发多个请求而更快撞到限制。如果你的账号有付费方案，可以改大。

> 想改默认值的话，直接改这两个函数里的字面值即可，**改一处全部生效**——这就是中间格式架构带来的好处。

---

### 第 6 步：写档与报告（输出层）

#### `writeJson()`：一个小而重要的函数

```js
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
```

| 这行 | 作用 |
|---|---|
| `path.dirname(file)` | 取出文件所在的文件夹路径 |
| `{ recursive: true }` | **中间层文件夹不存在就一路建立**。所以你不用先手动建 `cpa/per-account/` |
| `JSON.stringify(obj, null, 2)` | `2` 表示缩排两个空白，**产出人看得懂的排版** |

**为什么要缩排？** 因为你可能要打开文件人工检查、或用 `git diff` 比对两次导出的差异。压成一行的 JSON 没办法看 diff。

#### 四种输出的产生条件

```js
const wantCpa = a.target === "cpa" || a.target === "both";
const wantSub = a.target === "sub2api" || a.target === "both";
const wantMerged = a.mode === "merged" || a.mode === "both";
const wantSplit = a.mode === "split" || a.mode === "both";
```

**先把“要不要”算成四个布尔值**，后面就只要写四个 `if`：

```text
if (wantCpa && wantSplit)  → cpa/per-account/*.json + cpa/manifest.json
if (wantCpa && wantMerged) → cpa/cpa-xai-merged-<N>.json
if (wantSub && wantMerged) → sub2api/sub2api-<label>-all-<N>.json
if (wantSub && wantSplit)  → sub2api/per-account/*.json
```

这比在四个地方重复写 `a.target === "cpa" || a.target === "both"` 清楚得多。**把条件判断抽成有名字的变量，是让程序好读的最便宜手段。**

#### `manifest.json` 是什么，为什么需要它

只有 CPA split 模式会产生：

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

**为什么需要？** 因为 CPA 是一账号一档上传。当你面前有 200 个文件时，你会需要：

- 知道**应该有几个**（`count`）→ 可以验证有没有漏
- 拿到**完整文件名清单**（`files`）→ 可以写个 for 循环自动上传
- 记得**怎么上传**（`import_hint`）→ 半年后回来看还记得
- 知道**什么时候转的**（`exported_at`）→ 排查问题时很有用

**这就是为什么 `loadInput()` 要排除 `manifest.json`** ——它是给人和脚本看的说明书，不是账号数据。

#### `cpa-xai-merged-<N>.json` 为什么“不可导入”

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

**注意 `note` 字段——它把“这个文件不能导入”直接写在文件里。**

CPA 的导入 API 只吃单一账号的 JSON 档。这个汇总档存在的理由是：

| 用途 | 说明 |
|---|---|
| **备份** | 一个文件就是全部，方便存档 |
| **对照** | 用 `git diff` 比较两次导出差在哪 |
| **重跑来源** | 它自己可以当 `--input` 再转成 Sub2API |

每笔还多了一个 `file` 字段记录它对应哪个 per-account 文件名，方便交叉查找。

> **设计上的提醒**：如果一个文件很容易被误用，除了写在 README，**最好也在文件内容里写一句话说明**。使用者拿到文件时不一定手边有 README。

#### 文件名消毒：`safeName()`

```js
function safeName(email) {
  return String(email).replace(/[\\\/:*?"<>|]/g, "_");
}
```

把 Windows 文件名不允许的字元（`\ / : * ? " < > |`）换成底线。

**email 里怎么会有这些字元？** 正常不会，但：

- 来源数据可能被污染
- `hintName` 是从文件名来的，可能不是真的 email
- 有人手动改过文件

**如果不消毒，Windows 上 `fs.writeFileSync()` 会直接抛错，批量中断。** 一行防守换来的稳定性很值得。

#### 报告输出

```js
console.log(JSON.stringify(report, null, 2));
```

**印到 stdout（标准输出），而且是合法 JSON。** 这代表你可以：

```bash
node scripts/convert_xai_auth.mjs --input ./export --outdir ./out > report.json
```

把报告存成文件，或用其他工具接着处理。

**报告里绝对不含 token 值**，只有数量、路径、参数。这是刻意的：报告经常会被贴到聊天室或 issue 里讨论。

---

## 支持的输入形状（5 种）

| # | 形状 | 关键特征 | 由哪个分支认出 |
|---|---|---|---|
| 1 | **grokcli-2api admin 导出** | `{ "auth": { "https://auth.x.ai::<uuid>": { key, refresh_token } } }`；**access token 在 `key`** | `extractRecords()` ④ |
| 2 | **原生 grokcli auth 档** | `xai-<email>.json`，含 `type: "xai"`、`access_token`、`refresh_token`、`sub` | `extractRecords()` ⑦ |
| 3 | **CPA auth 档** | 平对象，含 `base_url`、`headers` | `extractRecords()` ⑦ |
| 4 | **Sub2API payload** | `accounts[].credentials` | `extractRecords()` ⑤⑥ |
| 5 | **JSON 数组 / JSONL / 文字导出** | 每行一个 JSON 对象 | `loadFile()` 的降级路径 |

**③④ 表示可以反向 round-trip**：CPA 档转回 Sub2API、Sub2API 档转成 CPA，都可以。

文件夹模式的跳过规则：

| 规则 | 为什么 |
|---|---|
| 只读 `.json` / `.jsonl` / `.txt` | 其他副文件名不可能是数据 |
| 跳过 `manifest.json` | **那是本工具产的清单档**，没有账号 |
| 跳过 `SHA256SUMS` | 那是校验档 |

---

## 四种输出：两轴交叉出来的

输出不是随便定的四种，是**两个独立的轴交叉**：

```text
                 --mode merged          --mode split
              ┌──────────────────────┬──────────────────────┐
--target cpa  │ cpa-xai-merged-N     │ per-account/         │
              │ .json                │   xai-<email>.json   │
              │ （备份用，不可导入）  │ + manifest.json      │
              │                      │ ← CPA 实际导入这些   │
              ├──────────────────────┼──────────────────────┤
--target      │ sub2api-<label>-     │ per-account/         │
  sub2api     │   all-N.json         │   <email>_sub2api    │
              │ ← Sub2API 批量导入   │   .json              │
              │                      │ （先验证单笔用）      │
              └──────────────────────┴──────────────────────┘
```

**两轴的意义完全不同：**

| 轴 | 决定什么 | 选错的后果 |
|---|---|---|
| `--target` | **格式**（字段名、时间精度、结构） | 导入被拒或导入成功但呼叫失败 |
| `--mode` | **打包方式**（一大包还是一堆小档） | 导入界面直接不接受 |

### 该用哪一个

```text
你要汇到哪里？
  │
  ├─ CPA
  │    └─► --target cpa --mode split
  │          用 per-account/xai-<email>.json
  │          （merged 那个只是备份，不要拿去导入）
  │
  └─ Sub2API
       │
       ├─ 第一次，想先确认格式对不对
       │    └─► --target sub2api --mode split
       │          拿一个 <email>_sub2api.json 先试
       │
       └─ 确认过了，要批量
            └─► --target sub2api --mode merged
                  用 sub2api-<label>-all-N.json
```

**不要一开始就丢 200 个账号。** 先用 split 拿一笔试导入，成功再放大。

---

## 参数说明

| 参数 | 值 | 默认 | 说明 |
|---|---|---|---|
| `--input` | 文件或文件夹 | **必填** | 来源导出。文件夹会读 `*.json`、`*.jsonl`、`*.txt`，并跳过 `manifest.json` / `SHA256SUMS` |
| `--outdir` | 文件夹 | **必填** | 输出根目录，会自动建立 `cpa/` 与 `sub2api/` |
| `--target` | `cpa` \| `sub2api` \| `both` | `both` | 要产出哪些格式 |
| `--mode` | `merged` \| `split` \| `both` | `both` | 汇总档、单账号档、或两者 |
| `--label` | 字符串 | `xai` | 用于输出文件名的标签，例如 `--label batch01` 产出 `sub2api-batch01-all-50.json` |
| `--limit` | 整数 | `0`（不限） | **去重后**只保留前 N 笔 |
| `--skip-expired` | 旗标（不用给值） | 关 | 丢掉 access token 已过期的账号 |
| `--exclude-emails` | 文件路径或逗号清单 | 无 | 排除这些 email（避免重复部署） |
| `--sub2api-base-url` | URL | `https://cli-chat-proxy.grok.com/v1` | 覆写 Sub2API 的 `credentials.base_url` |
| `--on-invalid` | `abort` \| `skip` | `abort` | 遇到不合格记录时中止整批（`abort`），或跳过该笔并在报告列出原因（`skip`） |

### 参数解析的设计

```js
default:
  throw new Error("unknown argument: " + k);
```

**传入未知参数会直接中止，不会默默忽略。**

**为什么这很重要？** 假设你打错字写成 `--taget cpa`。如果程序默默忽略，它会用默认值 `both` 跑完，你以为只产了 CPA，结果多产了 Sub2API 文件。**沉默的错误比明显的错误危险。**

而且因为 `parseArgs()` 在最前面就跑，**中止时还没建立任何目录**，不会留下半残的输出。

---

## 输出目录结构

```text
<outdir>/
├── cpa/
│   ├── cpa-xai-merged-<N>.json        # 仅备份 / 对照用，不可导入
│   ├── manifest.json                  # 数量 + 文件清单 + 导入提示
│   └── per-account/
│       └── xai-<email>.json           # ← CPA 实际导入的就是这些
└── sub2api/
    ├── sub2api-<label>-all-<N>.json   # ← Sub2API 批量导入
    └── per-account/
        └── <email>_sub2api.json       # 先验证单一账号用
```

**文件名里带数量 `<N>` 是刻意的**：你光看文件名就知道里面有几个账号，不用开文件数。同一个来源转两次，如果数量不一样，马上就会发现。

---

## 导入方式

### CPA / CLIProxyAPI

**一个账号一个文件。**

```bash
curl -X POST "<CPA_BASE>/v0/management/auth-files" \
  -F "file=@./converted/cpa/per-account/xai-user@example.com.json"
```

或直接把文件放进容器的 `auths/` 目录。

批量上传可以照着 `manifest.json` 的 `files` 清单写个循环。

> ⚠️ `cpa-xai-merged-<N>.json` **不可导入**，它只是备份与 diff 用的汇总档。

### Sub2API

后台导入接受 `sub2api-data` payload 对象：

- 批量：`sub2api/sub2api-<label>-all-<N>.json`
- 先试单笔：`sub2api/per-account/<email>_sub2api.json`

---
## 字段对应表

| 规范化字段 | CPA 输出 | Sub2API 输出 | 解析顺序（左优先） |
|---|---|---|---|
| access token | `access_token` | `credentials.access_token` | `access_token` / `accessToken` / **`key`** / `token` / `credentials.access_token` |
| refresh token | `refresh_token` | `credentials.refresh_token` | `refresh_token` / `refreshToken` / `credentials.refresh_token` |
| id token | 不使用 | 不使用 | `id_token` / `idToken` / `credentials.id_token`（只用来挖 email 和 sub） |
| email | `email` | `name`、`credentials.email`、`extra.email` | `email` / `credentials.email` / `extra.email` / access JWT `email` / id JWT `email` / 文件名 |
| 过期时间 | `expired`（RFC3339，**不含**毫秒） | `credentials.expires_at`（RFC3339，**含**毫秒） | `expires_at` / `credentials.expires_at` / `expired` → JWT `exp` → `last_refresh + expires_in` |
| 上次刷新 | `last_refresh` | 不使用 | JWT `iat` → `last_refresh` → `create_time` |
| principal | `user_id`、`sub`、`account_id` | 不使用 | `principal_id` / `user_id` / `sub` / JWT `principal_id` / JWT `sub` / id JWT `sub` |
| team | `team_id` | 不使用 | `team_id` / JWT `team_id`（允许空） |
| client id | `oidc_client_id` | `credentials.client_id` | JWT `client_id` / `oidc_client_id` / `client_id` / `credentials.client_id` / JWT `aud` / xAI 默认值 |
| scope | `scope` | 不使用 | JWT `scope` / `scope` / `credentials.scope` / xAI 默认值 |
| token type | `token_type` | `credentials.token_type` | `token_type` / `credentials.token_type` / `"Bearer"` |
| base url | 固定 `https://cli-chat-proxy.grok.com/v1` | `--sub2api-base-url` | 常数 / 参数 |
| auth header | `headers["X-XAI-Token-Auth"] = "xai-grok-cli"` | 不使用 | 常数 |

### 固定常数

| 项目 | 值 | 说明 |
|---|---|---|
| xAI OIDC issuer | `https://auth.x.ai` | 发证机关 |
| xAI grok-cli client_id | `b1a00492-073a-47ea-816f-4c329264a828` | grok-cli 官方公开客户端 ID |
| `account_id` 组法 | `https://auth.x.ai::<principal_id>` | 注意是**两个冒号** |
| 默认 scope | `openid profile email offline_access grok-cli:access api:access` | grok-cli 的标准权限集 |
| CPA 固定字段 | `type: "xai"`、`auth_kind: "oauth"`、`disabled: false` | — |
| Sub2API 固定字段 | `platform: "grok"`、`type: "oauth"`、`concurrency: 1`、`priority: 1`、`rate_multiplier: 1`、`auto_pause_on_expired: true` | — |

> **⚠️ `disabled: false` 的行为要记住**：CPA 输出一律写 `false`，所以来源池里**被停用的账号依然会被导出成启用状态**。原因见[第 5 步](#第-5-步长成两边要的样子渲染层)的说明。如果这件事对你有影响，请另外去来源池确认状态，或用 `--exclude-emails` 排除。

### 敏感字段不会被搬过去

源文件可能含这些字段，**两种输出格式都不使用它们，也不会复制过去**：

| 字段 | 是什么 |
|---|---|
| `password` | 账号密码明文 |
| `sso` | SSO cookie |
| `session_cookies` | 浏览器 session |

因为渲染层是**明确列出要哪些字段**（白名单），不是“复制整个对象再删掉几个”（黑名单）。**白名单比黑名单安全**：新来源多了一个敏感字段时，白名单自动不会漏出去，黑名单则需要你记得去加。

---

## 执行报告怎么读

脚本结束时把报告以 JSON 印到 stdout：

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

### 先做一个算式检查

```text
source_records_seen
  - skipped.incomplete
  - skipped.duplicate
  - skipped.excluded
  - skipped.expired
  = accounts_converted        ← 应该刚好相等（除非用了 --limit）
```

上面的例子：`120 - 2 - 3 - 0 - 0 = 115` ✅

**如果算不出来，代表你用了 `--limit`**（它在最后才切）。

### 每个字段怎么判读

| 字段 | 判读 | 要不要担心 |
|---|---|---|
| `source_records_seen` | 从源文件总共挖出几笔 | 比预期少 → 检查是不是格式没被认出来 |
| `accounts_converted` | 最后真的写出去几个 | 这是最重要的数字 |
| `skipped.incomplete` | 缺 access / refresh token / email | 少量正常；**大量代表格式没被认对** |
| `skipped.duplicate` | 依 `account_id`（退回 email）判定重复 | 正常。同一账号出现在多个源文件时会有 |
| `skipped.excluded` | 被 `--exclude-emails` 排除 | 应该等于你清单的笔数 |
| `skipped.expired` | 被 `--skip-expired` 丢掉 | 没加那个参数就一定是 0 |
| `warnings.access_token_already_expired` | 门票过期，但仍导出 | **可接受**，导入后会自动续期 |
| `warnings.missing_team_id` | 没有 team | 通常可忽略，个人账号本来就没 team |
| `warnings.missing_principal_id` | 没有使用者 ID | **要注意**，`account_id` 会是空的，CPA 可能无法正确辨识 |
| `file_stamp` | 这次执行的时间戳 | 排查问题时用来对照 log |

### 最需要警觉的一种情况

```text
"source_records_seen": 200,
"accounts_converted": 0,
"skipped": { "incomplete": 200, ... }
```

**200 笔全部“不完整”= 你的来源格式没被正确辨识。**

最常见的原因就是**没认出 access token 在 `key` 字段**。用文字编辑器打开源文件看一眼，确认：

- 是不是 `{ "auth": { ... } }` 这种形状
- token 是放在 `key` 还是 `access_token`
- 有没有 `refresh_token`（**只有 access token 没有 refresh token 也会全部被丢掉**）

---

## 安全护栏

| 护栏 | 行为 | 实现位置 |
|---|---|---|
| 不写入来源 | 绝不写进 `--input` 目录，一律写 `--outdir` | `main()` 所有 `writeJson()` 都以 `a.outdir` 为根 |
| 不搬敏感字段 | `password` / `sso` / `session_cookies` 都不会出现在输出 | `toCpa()` / `toSub2api()` 用白名单 |
| 不外泄 token | 报告只有数量、路径、参数，没有 token 值 | `report` 对象 |
| 参数防呆 | 未知参数直接中止，**不建立空目录** | `parseArgs()` 的 `default: throw` |
| 文件名消毒 | 非法字元换成底线 | `safeName()` |
| 不吃自己的清单档 | 跳过 `manifest.json` / `SHA256SUMS` | `loadInput()` |
| 每账号独立 header | `Object.assign({}, ...)` 浅拷贝 | `toCpa()` |
| 版控隔离 | `.gitignore` 已排除 `out/`、`cpa/`、`sub2api/`、`xai-*.json` 等输出 | `.gitignore` |
| 不联网 | 整支脚本没有任何网络呼叫 | — |

### ⚠️ refresh token 是单一持有者

这是很多人吃过的苦头，一定要理解：

```text
同一份 refresh token
        │
        ├──► CPA      用它换新 token → 旧的作废
        │
        └──► Sub2API  用旧的去换 → invalid_grant ❌
```

同一个账号**同时**导入 CPA 与 Sub2API，其中一边迟早会开始回：

```text
invalid_grant / Refresh token has been revoked
```

**请保持部署互斥**：一个账号只在一个地方跑。用 `--exclude-emails` 维持。

### ⚠️ 转换成功 ≠ 有额度

转换只保证**格式正确**。账号本身仍可能回：

| 错误 | 意思 | 跟转换有关吗 |
|---|---|---|
| `402 personal-team-blocked:spending-limit` | 该 team 的消费上限到了 | ❌ 无关 |
| `429 free-usage-exhausted` | 免费滚动额度用完 | ❌ 无关 |
| `401 Invalid or expired credentials` | token 真的失效了 | ❌ 无关（需要重新授权） |
| `invalid_grant` | refresh token 被撤销 | ⚠️ 可能是两边同时持有造成 |

**格式对，不代表账号能用。这是两件事。**

---

## 常见错误排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `unknown argument: --xxx` | 参数拼错 | 对照[参数说明](#参数说明)，注意都是小写加两个减号 |
| `--input is required` | 少了必填参数 | 补上 `--input` |
| `--outdir is required` | 少了必填参数 | 补上 `--outdir` |
| `--target must be cpa\|sub2api\|both` | 值拼错或大写 | 用小写合法值 |
| `--mode must be merged\|split\|both` | 同上 | 用小写合法值 |
| `ENOENT: no such file or directory` | `--input` 路径不存在 | 检查路径，Windows 路径有空白要加引号 |
| 转换数为 0，`skipped.incomplete` 很大 | 来源缺 access / refresh token；或格式未被辨识 | **确认 access token 是否在 `key` 字段**；确认有 `refresh_token` |
| `source_records_seen` 是 0 | 文件空的、路径指错、或副文件名不是 json/jsonl/txt | 确认副文件名；确认不是只有 `manifest.json` |
| CPA 导入失败 | 误用了 merged 汇总档 | 改用 `cpa/per-account/xai-<email>.json` |
| Sub2API 导入失败 | 丢了 CPA 档或裸数组 | 用 `sub2api-<label>-all-<N>.json` |
| CPA 导入成功但呼叫失败 | 少了 `X-XAI-Token-Auth` header | 确认文件是本工具产的，不是手改的 |
| 导入后 `invalid_grant` | 同一账号被两套环境同时持有 | 一边停用，并用 `--exclude-emails` 隔离 |
| `Buffer.from(...) base64url` 相关错误 | Node 版本太旧 | 升级到 Node 18+ |
| 时间字段是空字符串 | 来源没有时间信息，JWT 也解不出 | 检查 `access_token` 是否真的是 JWT（有两个点） |

### “跑完了但导入还是失败”怎么查

```text
1. 你要汇到哪里？
     ├─ CPA     → 文件应该是 cpa/per-account/xai-<email>.json
     │             ✗ 用了 cpa-xai-merged-N.json → 换文件，那个不能导入
     └─ Sub2API → 文件应该是 sub2api-<label>-all-N.json
                   ✗ 用了 CPA 档 → 换文件

2. 打开文件，顶层是 { } 还是 [ ] ？
     └─ 是 [ ] → 不对。两种格式的顶层都是对象

3. CPA 档里有这三个吗？
     type: "xai" / base_url / headers["X-XAI-Token-Auth"]
     └─ 缺 → 这个文件不是本工具产的，重跑一次

4. Sub2API 档顶层有 "type": "sub2api-data" 吗？
   accounts[].platform 是 "grok" 吗？
     └─ 否 → 同上，重跑

5. expires_at / expired 的时间已经过去了吗？
     └─ 是 → 正常。只要 refresh_token 有效，
             导入后会自动续期。这不是转换问题

6. 导入成功但呼叫回 402 / 429 ？
     └─ 账号本身没额度，跟转换无关

7. 导入成功但回 invalid_grant ？
     └─ 这个账号的 refresh token 已经被别的环境用掉了
         → 检查是不是同时部署在两边
```

---

## 验证清单

转换完成后，建议逐项确认：

1. **数量对得上**：`accounts_converted` 与预期一致，`skipped` 各项都能解释（用[上面的算式](#先做一个算式检查)）
2. **JSON 合法**：
   ```bash
   node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('ok')" ./converted/sub2api/sub2api-xai-all-115.json
   ```
3. **email 集合完全相同**：与来源比对，没有漏、没有多
4. **CPA 形状正确**：per-account 档含 `type: "xai"`、`base_url`、`headers["X-XAI-Token-Auth"]`
5. **Sub2API 形状正确**：顶层是 `sub2api-data` **对象**，`accounts[].platform == "grok"`
6. **时间精度正确**：CPA 的 `expired` **没有**毫秒，Sub2API 的 `expires_at` **有**毫秒
7. **敏感字段不存在**：输出中搜寻 `password` / `sso` / `session_cookies`，应该找不到
8. **先试单笔**：两边都先汇一个账号，成功再批量

---

## 手动整理 vs 用这支脚本

| 项目 | 手动 | 本脚本 |
|---|---|---|
| 200 个账号耗时 | 数小时 | 数秒 |
| 认出 access token 在 `key` | 要先发现这件事 | 自动 |
| 两种时间精度 | 容易写成一样 | 自动分开 |
| 从 JWT 挖 scope / client_id / team_id | 要贴到 Base64 解码网站 200 次 | 自动，且**不联网** |
| 组 `account_id` | 容易忘记两个冒号 | 自动 |
| 补 `X-XAI-Token-Auth` header | 很容易漏，而且漏了不会报错 | 自动 |
| `user_id` / `sub` 要填两份 | 不知道要这样做 | 自动 |
| 去重 | 眼睛看 | 自动，用 `account_id` |
| 排除已部署账号 | 手动比对清单 | `--exclude-emails` |
| 敏感字段外泄风险 | 高（复制贴上时容易带到） | 低（白名单） |
| 结果可重现 | 否 | 是 |
| 出错时知道原因 | 不知道 | 报告的 `skipped` 分类 |

---

## 名词表

| 名词 | 一句话解释 |
|---|---|
| **xAI** | Grok 背后的公司，也是发放 token 的机关 |
| **Grok** | xAI 的 AI 模型 |
| **grokcli-2api** | 管理 Grok 账号的工具，本项目的主要**来源** |
| **CPA / CLIProxyAPI** | 代理工具，本项目的**目的地一** |
| **Sub2API** | 代理工具，本项目的**目的地二** |
| **auth** | authorization / authentication 的简称，泛指“登入凭证” |
| **token** | 令牌，临时通行证 |
| **access_token** | 门票。呼叫 API 时出示 |
| **refresh_token** | 换票券。门票过期时换新的。**单一持有者** |
| **id_token** | 身份证。记载你是谁 |
| **JWT** | JSON Web Token，一种 token 格式，中间段可直接解出内容 |
| **claim** | JWT payload 里的一个字段 |
| **Base64 / Base64URL** | 一种编码方式，**不是加密**，任何人可还原 |
| **Unix 时间戳** | 从 1970-01-01 起算的秒数（或毫秒数） |
| **RFC3339** | 时间字符串标准格式，本项目要分“含毫秒”和“不含毫秒” |
| **OAuth** | 一套“不给密码也能授权”的标准流程 |
| **issuer** | 发证机关，本项目固定 `https://auth.x.ai` |
| **client_id** | 应用程序的身份证号 |
| **scope** | token 的权限清单 |
| **principal_id** | 使用者本人的唯一 ID |
| **team_id** | 账号所属团队（可空） |
| **account_id** | `<issuer>::<principal_id>` 复合 ID |
| **JSON** | 用文字描述数据的格式 |
| **JSONL** | 一行一个 JSON 对象的文件 |
| **BOM** | 文件开头看不见的标记字节，要砍掉才能 parse |
| **canonical model** | 中间格式，所有输入先转成它，再转成各种输出 |
| **递归** | 函数呼叫自己，用来处理不确定深度的嵌套结构 |
| **Set** | 不重复集合，查询是 O(1) |
| **白名单 / 黑名单** | 白名单=只允许列出的；黑名单=只挡列出的。安全上白名单较好 |
| **浅拷贝** | 复制对象的第一层，避免多个地方共用同一个对象 |
| **stdout / stderr** | 标准输出 / 标准错误，两条不同的输出管道 |
| **round-trip** | 来回转换，A→B 之后还能 B→A |

---

## 作为 Codex 技能安装

把整个 repo 放到技能目录，Codex / Claude 就能自动载入：

```text
<你的技能根目录>/xai-cpa-sub2api-convert/
├── SKILL.md                       ← AI 读这个决定何时使用
├── agents/openai.yaml             ← 技能中介数据
└── scripts/convert_xai_auth.mjs   ← 实际执行的脚本
```

之后你就可以直接用自然语言下指令。触发语句示例：

- “把这批 Grok 账号转成 CPA 可导入的文件”
- “帮我做一份 Sub2API 批量导入档，排除已经在 CPA 的账号”
- “这个 grokcli-2api 导出档转成一账号一档”
- “把这个 CPA auth 档转回 Sub2API 格式”

AI 会自己判断该用什么 `--target` / `--mode` 组合、要不要加 `--exclude-emails`。

---

## 版本控制

- 版本号记录于 [`VERSION`](VERSION)
- 变更历史记录于 [`CHANGELOG.md`](CHANGELOG.md)
- 遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)：`MAJOR.MINOR.PATCH`

| 位置 | 什么时候加 | 对使用者的影响 |
|---|---|---|
| **MAJOR** | CPA 或 Sub2API 输出形状变更 | ⚠️ 会破坏既有导入流程，升级前要看 CHANGELOG |
| **MINOR** | 新增输入形状、新增参数 | 向下兼容，旧指令照样能跑 |
| **PATCH** | 修错字、修边界行为 | 无感升级 |

目前版本：**1.1.0**

---

## 授权

[MIT](LICENSE)
