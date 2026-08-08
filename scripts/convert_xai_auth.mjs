#!/usr/bin/env node
/**
 * xai-cpa-sub2api-convert
 *
 * Convert xAI / Grok account exports into:
 *   - CPA (CLIProxyAPI) xAI OAuth auth files
 *   - Sub2API import payloads (sub2api-data)
 *
 * No dependencies. Node 18+.
 *
 * Usage:
 *   node convert_xai_auth.mjs --input <file|folder> --target both --mode both --outdir <folder>
 */

import fs from "node:fs";
import path from "node:path";

const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_ISSUER = "https://auth.x.ai";
const CPA_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
const CPA_TOKEN_HEADER = { "X-XAI-Token-Auth": "xai-grok-cli" };
const DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const a = {
    input: null,
    outdir: null,
    target: "both",          // cpa | sub2api | both
    mode: "both",            // merged | split | both
    sub2apiBaseUrl: CPA_BASE_URL,
    label: "xai",
    limit: 0,
    excludeEmails: null,     // file with one email per line, or comma list
    skipExpired: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--input": a.input = v; i++; break;
      case "--outdir": a.outdir = v; i++; break;
      case "--target": a.target = String(v).toLowerCase(); i++; break;
      case "--mode": a.mode = String(v).toLowerCase(); i++; break;
      case "--sub2api-base-url": a.sub2apiBaseUrl = v; i++; break;
      case "--label": a.label = v; i++; break;
      case "--limit": a.limit = Number(v) || 0; i++; break;
      case "--exclude-emails": a.excludeEmails = v; i++; break;
      case "--skip-expired": a.skipExpired = true; break;
      default:
        throw new Error("unknown argument: " + k);
    }
  }
  if (!a.input) throw new Error("--input is required");
  if (!a.outdir) throw new Error("--outdir is required");
  if (!["cpa", "sub2api", "both"].includes(a.target)) throw new Error("--target must be cpa|sub2api|both");
  if (!["merged", "split", "both"].includes(a.mode)) throw new Error("--mode must be merged|split|both");
  return a;
}

// ---------------------------------------------------------------- helpers

function jwtPayload(token) {
  if (typeof token !== "string" || !token.includes(".")) return {};
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch { return {}; }
}

function toEpoch(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

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

function safeName(email) {
  return String(email).replace(/[\\/:*?"<>|]/g, "_");
}

function readJson(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

// ---------------------------------------------------------------- canonical model

/**
 * Canonical account record. Every supported source shape is normalized to this,
 * then rendered into CPA / Sub2API. Fields are resolved with this precedence:
 *   explicit source field -> access_token JWT claim -> documented xAI default
 */
function canonicalize(src, hintName) {
  const access =
    src.access_token || src.accessToken || src.key || src.token ||
    (src.credentials && src.credentials.access_token) || "";
  const refresh =
    src.refresh_token || src.refreshToken ||
    (src.credentials && src.credentials.refresh_token) || "";
  const idToken =
    src.id_token || src.idToken || (src.credentials && src.credentials.id_token) || "";

  const pl = jwtPayload(access);
  const idpl = jwtPayload(idToken);
  const cred = src.credentials || {};

  const principal =
    src.principal_id || src.user_id || src.sub || pl.principal_id || pl.sub || idpl.sub || "";

  const email =
    src.email || cred.email || (src.extra && src.extra.email) ||
    pl.email || idpl.email || hintName || "";

  const accountId =
    src.account_id || src.id ||
    (principal ? XAI_ISSUER + "::" + principal : "");

  // Explicit source expiry wins; grokcli-2api stores the authoritative value and
  // it can differ from the JWT exp claim by a second. JWT exp is the fallback.
  const expEpoch =
    toEpoch(src.expires_at) || toEpoch(cred.expires_at) || toEpoch(src.expired) ||
    toEpoch(pl.exp) ||
    (src.expires_in && src.last_refresh
      ? toEpoch(src.last_refresh) + Number(src.expires_in) : 0);

  const iatEpoch = toEpoch(pl.iat) || toEpoch(src.last_refresh) || toEpoch(src.create_time);

  return {
    email,
    access_token: access,
    refresh_token: refresh,
    id_token: idToken,
    token_type: src.token_type || cred.token_type || "Bearer",
    scope: pl.scope || src.scope || cred.scope || DEFAULT_SCOPE,
    client_id:
      pl.client_id || src.oidc_client_id || src.client_id || cred.client_id ||
      pl.aud || XAI_CLIENT_ID,
    principal_id: principal,
    team_id: src.team_id || pl.team_id || "",
    account_id: accountId,
    expires_at: expEpoch,
    last_refresh: iatEpoch,
    disabled: src.disabled === true,
    source_disabled_reason: src.disabled_reason || src.source_pool_status || "",
  };
}

function isUsable(rec) {
  return Boolean(rec.access_token && rec.refresh_token && rec.email);
}

// ---------------------------------------------------------------- source detection

function extractRecords(node, hintName, out) {
  if (node == null) return;

  if (Array.isArray(node)) {
    for (const item of node) extractRecords(item, hintName, out);
    return;
  }
  if (typeof node !== "object") return;

  // grokcli-2api admin export: { "auth": { "<account_id>": {...} } }
  if (node.auth && typeof node.auth === "object" && !Array.isArray(node.auth)) {
    for (const [k, v] of Object.entries(node.auth)) extractRecords(v, k, out);
    return;
  }

  // sub2api-data / CPA merged bundle / grokcli export: { accounts: [...] }
  if (Array.isArray(node.accounts)) {
    for (const item of node.accounts) extractRecords(item, hintName, out);
    return;
  }

  // sub2api account object: credentials nested
  if (node.credentials && typeof node.credentials === "object") {
    const merged = Object.assign({}, node.credentials, {
      email: node.credentials.email || (node.extra && node.extra.email) || node.name,
      disabled: node.disabled,
    });
    out.push(canonicalize(merged, hintName));
    return;
  }

  // flat account object (grokcli native xai file, CPA auth file, admin auth entry)
  if (node.access_token || node.key || node.refresh_token) {
    out.push(canonicalize(node, hintName));
    return;
  }
}

function loadFile(file, out) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const hint = path.basename(file).replace(/^xai-/, "").replace(/\.(json|jsonl|txt)$/i, "");

  if (ext === ".jsonl") {
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s[0] !== "{") continue;
      try { extractRecords(JSON.parse(s), hint, out); } catch {}
    }
    return;
  }

  try {
    extractRecords(JSON.parse(raw), hint, out);
    return;
  } catch {}

  // text export: one JSON object per line, possibly after a heading
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] !== "{") continue;
    try { extractRecords(JSON.parse(s), hint, out); } catch {}
  }
}

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

// ---------------------------------------------------------------- renderers

/** CPA (CLIProxyAPI) xAI OAuth auth file. Filename must be xai-<email>.json */
function toCpa(rec) {
  return {
    type: "xai",
    auth_kind: "oauth",
    email: rec.email,
    access_token: rec.access_token,
    refresh_token: rec.refresh_token,
    token_type: rec.token_type,
    expired: toIso(rec.expires_at),
    last_refresh: toIso(rec.last_refresh),
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

/** Sub2API account entry inside a sub2api-data payload. */
function toSub2api(rec, baseUrl) {
  return {
    name: rec.email,
    platform: "grok",
    type: "oauth",
    credentials: {
      access_token: rec.access_token,
      refresh_token: rec.refresh_token,
      token_type: rec.token_type,
      expires_at: toIsoMs(rec.expires_at),
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

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

// ---------------------------------------------------------------- main

function main() {
  const a = parseArgs(process.argv);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const fileStamp = stamp.replace(/[-:]/g, "").replace("Z", "Z");
  const nowEpoch = Math.floor(Date.now() / 1000);

  let exclude = new Set();
  if (a.excludeEmails) {
    if (fs.existsSync(a.excludeEmails)) {
      for (const line of fs.readFileSync(a.excludeEmails, "utf8").split(/\r?\n/)) {
        const s = line.trim(); if (s) exclude.add(s.toLowerCase());
      }
    } else {
      for (const s of a.excludeEmails.split(",")) if (s.trim()) exclude.add(s.trim().toLowerCase());
    }
  }

  const raw = loadInput(a.input);

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

  const wantCpa = a.target === "cpa" || a.target === "both";
  const wantSub = a.target === "sub2api" || a.target === "both";
  const wantMerged = a.mode === "merged" || a.mode === "both";
  const wantSplit = a.mode === "split" || a.mode === "both";

  const written = { cpa_split: 0, sub2api_split: 0, files: [] };

  if (wantCpa && wantSplit) {
    const dir = path.join(a.outdir, "cpa", "per-account");
    for (const r of records) {
      const f = path.join(dir, "xai-" + safeName(r.email) + ".json");
      writeJson(f, toCpa(r));
      written.cpa_split++;
    }
    const manifest = path.join(a.outdir, "cpa", "manifest.json");
    writeJson(manifest, {
      exported_at: stamp,
      format: "CLIProxyAPI xAI OAuth",
      label: a.label,
      count: records.length,
      import_hint: "POST /v0/management/auth-files (multipart file=@xai-<email>.json), one file per account",
      files: records.map(r => "xai-" + safeName(r.email) + ".json"),
    });
    written.files.push(manifest);
  }

  if (wantCpa && wantMerged) {
    const f = path.join(a.outdir, "cpa", "cpa-xai-merged-" + records.length + ".json");
    writeJson(f, {
      type: "cliproxyapi-xai-auth-bundle",
      version: 1,
      exported_at: stamp,
      note: "CPA /v0/management/auth-files imports individual JSON files; this merged file is backup/reference only.",
      count: records.length,
      accounts: records.map(r => Object.assign({ file: "xai-" + safeName(r.email) + ".json" }, toCpa(r))),
    });
    written.files.push(f);
  }

  if (wantSub && wantMerged) {
    const f = path.join(a.outdir, "sub2api", "sub2api-" + a.label + "-all-" + records.length + ".json");
    writeJson(f, {
      type: "sub2api-data",
      version: 1,
      exported_at: stamp,
      proxies: [],
      accounts: records.map(r => toSub2api(r, a.sub2apiBaseUrl)),
    });
    written.files.push(f);
  }

  if (wantSub && wantSplit) {
    const dir = path.join(a.outdir, "sub2api", "per-account");
    for (const r of records) {
      const f = path.join(dir, safeName(r.email) + "_sub2api.json");
      writeJson(f, {
        type: "sub2api-data",
        version: 1,
        exported_at: stamp,
        proxies: [],
        accounts: [toSub2api(r, a.sub2apiBaseUrl)],
      });
      written.sub2api_split++;
    }
  }

  const expiredNow = records.filter(r => r.expires_at && r.expires_at <= nowEpoch).length;
  const noTeam = records.filter(r => !r.team_id).length;
  const noPrincipal = records.filter(r => !r.principal_id).length;

  const report = {
    input: a.input,
    outdir: a.outdir,
    target: a.target,
    mode: a.mode,
    source_records_seen: raw.length,
    accounts_converted: records.length,
    skipped,
    cpa_per_account_files: written.cpa_split,
    sub2api_per_account_files: written.sub2api_split,
    merged_files: written.files,
    warnings: {
      access_token_already_expired: expiredNow,
      missing_team_id: noTeam,
      missing_principal_id: noPrincipal,
    },
    sub2api_base_url: a.sub2apiBaseUrl,
    file_stamp: fileStamp,
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
