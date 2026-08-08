/**
 * Browser shell for xai-cpa-sub2api-convert.
 *
 * All conversion rules come from core.mjs, the same module the CLI imports.
 * This file only deals with files, options, progress and downloads.
 */

import { convert, detectSkipHint, parseSource, serialize } from "./core.mjs";
import { LANGS, resolveLang, t } from "./i18n.js";
import { zip } from "./vendor/fflate.min.mjs";

const VERSION = "1.1.0";
const LANG_KEY = "authconv.lang";
const CHUNK = 200;

const $ = (id) => document.getElementById(id);

const state = {
  lang: "zh-TW",
  files: [],          // { name, size, records, hint, included, error }
  report: null,
  aborted: null,
  blobUrl: null,
  blobSize: 0,
  downloadName: "",
  running: false,
};

/* ------------------------------------------------------------------- i18n */

function applyLang() {
  document.documentElement.lang =
    state.lang === "zh-TW" ? "zh-Hant" : state.lang === "zh-CN" ? "zh-Hans" : "en";

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(state.lang, el.getAttribute("data-i18n"));
  }
  for (const el of document.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.getAttribute("data-i18n-attr").split(";")) {
      const [attr, key] = pair.split(":");
      if (attr && key) el.setAttribute(attr.trim(), t(state.lang, key.trim()));
    }
  }
  for (const btn of document.querySelectorAll(".langs button")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.lang === state.lang));
  }
  $("foot-legal").textContent = t(state.lang, "footer.legal", { version: VERSION });

  renderFiles();
  renderResult();
}

function setLang(lang) {
  state.lang = LANGS.includes(lang) ? lang : "en";
  try { localStorage.setItem(LANG_KEY, state.lang); } catch { /* private mode */ }
  applyLang();
}

/* ------------------------------------------------------------------ format */

function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function reasonText(code) {
  return t(state.lang, "reason." + code);
}

/* -------------------------------------------------------------- file input */

async function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  for (const file of incoming) {
    const name = file.webkitRelativePath || file.name;
    if (state.files.some((f) => f.name === name && f.size === file.size)) continue;

    const entry = { name, size: file.size, records: [], hint: null, included: true, error: null };
    entry.hint = detectSkipHint(name);
    if (entry.hint) entry.included = false;
    try {
      const text = await file.text();
      const { records, parseError } = parseSource(text, name);
      if (parseError) {
        entry.error = t(state.lang, "state.parseError", {
          source: name, line: parseError.line, message: parseError.message,
        });
        entry.included = false;
      } else {
        entry.records = records;
      }
    } catch (err) {
      entry.error = t(state.lang, "state.readError", {
        source: name, message: err && err.message ? err.message : String(err),
      });
      entry.included = false;
    }
    state.files.push(entry);
  }
  clearResult();
  renderFiles();
}

function renderFiles() {
  const list = $("file-list");
  list.textContent = "";

  for (const [i, f] of state.files.entries()) {
    const li = document.createElement("li");
    if (f.error) li.className = "bad";
    else if (!f.included) li.className = "skip";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = (f.error ? "\u2715 " : f.included ? "\u2713 " : "\u2298 ") + f.name;
    li.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = formatBytes(f.size);
    li.appendChild(meta);

    const grow = document.createElement("span");
    grow.className = "grow";
    li.appendChild(grow);

    if (f.error) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = f.error;
      li.appendChild(tag);
    } else {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = f.included
        ? t(state.lang, "card1.records", { n: f.records.length })
        : t(state.lang, "hint." + f.hint.reason);
      li.appendChild(tag);

      if (f.hint) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn small";
        btn.textContent = t(state.lang, f.included ? "card1.exclude" : "card1.include");
        btn.addEventListener("click", () => {
          state.files[i].included = !state.files[i].included;
          clearResult();
          renderFiles();
        });
        li.appendChild(btn);
      }
    }

    list.appendChild(li);
  }

  $("file-actions").classList.toggle("hidden", state.files.length === 0);
  $("run").disabled = state.running || activeRecords().length === 0;
}

function activeRecords() {
  const out = [];
  for (const f of state.files) {
    if (!f.included || f.error) continue;
    out.push(...f.records);
  }
  return out;
}

/* --------------------------------------------------------------- conversion */

function clearResult() {
  state.report = null;
  state.aborted = null;
  if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
  state.blobSize = 0;
  $("result-card").classList.add("hidden");
}

function selectedRadio(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : "";
}

/** Two checkboxes collapse into the CLI vocabulary: one value, or "both". */
function selectedPair(name, a, b) {
  const on = Array.from(document.querySelectorAll('input[name="' + name + '"]:checked'))
    .map((el) => el.value);
  if (on.includes(a) && on.includes(b)) return "both";
  if (on.includes(a)) return a;
  if (on.includes(b)) return b;
  return "";
}

async function run() {
  const items = activeRecords();
  if (!items.length) return;

  const target = selectedPair("target", "cpa", "sub2api");
  const mode = selectedPair("mode", "merged", "split");

  $("result-card").classList.remove("hidden");
  if (!target || !mode) {
    state.report = null;
    state.aborted = null;
    $("messages").textContent = "";
    addMessage("err", t(state.lang, "state.noTarget"));
    $("download-actions").classList.add("hidden");
    $("fail-block").classList.add("hidden");
    return;
  }

  state.running = true;
  $("run").disabled = true;
  $("run").textContent = t(state.lang, "card2.running");
  $("bar").style.width = "0%";

  const label = ($("label").value || "xai").trim() || "xai";
  const skipExpired = $("skip-expired").checked;
  const onInvalid = selectedRadio("oninvalid") || "skip";

  // Chunked so a large batch keeps the progress bar moving.
  const collected = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    collected.push(...items.slice(i, i + CHUNK));
    $("bar").style.width = Math.round((collected.length / items.length) * 100) + "%";
    await new Promise((r) => setTimeout(r, 0));
  }

  const report = convert(items, { target, mode, label, skipExpired, onInvalid });
  state.report = report;
  state.aborted = report.aborted;

  if (report.outputs.length) await buildDownload(report);

  state.running = false;
  $("run").textContent = t(state.lang, "card2.run");
  $("bar").style.width = "100%";
  renderFiles();
  renderResult();
}

/** Always a ZIP: the CLI writes a directory tree, so the download mirrors it. */
async function buildDownload(report) {
  if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
  state.blobSize = 0;

  const enc = new TextEncoder();
  const tree = {};
  for (const out of report.outputs) tree[out.path] = enc.encode(serialize(out.json));

  const bytes = await new Promise((resolve, reject) => {
    zip(tree, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const zipBlob = new Blob([bytes], { type: "application/zip" });
  state.downloadName = "xai-convert-" + report.counts.converted + ".zip";
  state.blobSize = zipBlob.size;
  state.blobUrl = URL.createObjectURL(zipBlob);
}

/* ------------------------------------------------------------------ results */

function addMessage(kind, text) {
  const div = document.createElement("div");
  div.className = "msg " + kind;
  div.textContent = text;
  $("messages").appendChild(div);
}

function renderResult() {
  const report = state.report;
  if (!report) return;

  const c = report.counts;
  $("stat-seen").textContent = String(c.seen);
  $("stat-ok").textContent = String(c.converted);
  $("stat-skip").textContent = String(report.skipped.length);

  $("messages").textContent = "";

  if (state.aborted) {
    addMessage("err", t(state.lang, "state.aborted", {
      source: state.aborted.source,
      position: state.aborted.position,
      reason: state.aborted.reasons.map(reasonText).join(", "),
    }));
  } else if (c.seen === 0) {
    addMessage("info", t(state.lang, "state.empty"));
  } else if (c.converted === 0) {
    addMessage("err", t(state.lang, "state.noneUsable"));
  }

  if (c.unrecognized) {
    addMessage("warn", t(state.lang, "card3.unrecognized", { n: c.unrecognized }));
  }
  if (report.warnings.access_token_already_expired) {
    addMessage("warn", t(state.lang, "card3.warn.expired", { n: report.warnings.access_token_already_expired }));
  }
  if (report.warnings.missing_team_id) {
    addMessage("warn", t(state.lang, "card3.warn.noteam", { n: report.warnings.missing_team_id }));
  }
  if (report.warnings.missing_principal_id) {
    addMessage("warn", t(state.lang, "card3.warn.noprincipal", { n: report.warnings.missing_principal_id }));
  }

  const hasDownload = Boolean(state.blobUrl);
  $("download-actions").classList.toggle("hidden", !hasDownload);
  if (hasDownload) {
    const a = $("download");
    a.href = state.blobUrl;
    a.download = state.downloadName;
    a.textContent = t(state.lang, "card3.download", {
      name: state.downloadName,
      size: formatBytes(state.blobSize),
    });
  }

  renderFailures(report.skipped);
}

function renderFailures(skipped) {
  const block = $("fail-block");
  const rows = $("fail-rows");
  const cards = $("fail-cards");
  rows.textContent = "";
  cards.textContent = "";

  if (!skipped.length) {
    block.classList.add("hidden");
    return;
  }
  block.classList.remove("hidden");
  $("fail-title").textContent = t(state.lang, "card3.failTitle", { n: skipped.length });

  const noEmail = t(state.lang, "card3.noEmail");
  for (const s of skipped) {
    const cells = [
      s.source,
      s.position,
      s.emailMasked || noEmail,
      s.reasons.map(reasonText).join(", "),
    ];

    const tr = document.createElement("tr");
    cells.forEach((value, i) => {
      const td = document.createElement("td");
      if (i === 3) td.className = "reason";
      td.textContent = value;
      tr.appendChild(td);
    });
    rows.appendChild(tr);

    const fc = document.createElement("div");
    fc.className = "fc";
    const dl = document.createElement("dl");
    const labels = ["card3.col.source", "card3.col.position", "card3.col.email", "card3.col.reason"];
    labels.forEach((key, i) => {
      const dt = document.createElement("dt");
      dt.textContent = t(state.lang, key);
      const dd = document.createElement("dd");
      dd.textContent = cells[i];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    fc.appendChild(dl);
    cards.appendChild(fc);
  }
}

function reportText() {
  const report = state.report;
  if (!report) return "";
  const lines = [];
  lines.push("xai-cpa-sub2api-convert " + VERSION);
  lines.push("seen=" + report.counts.seen + " converted=" + report.counts.converted +
             " incomplete=" + report.counts.incomplete + " duplicate=" + report.counts.duplicate +
             " excluded=" + report.counts.excluded + " expired=" + report.counts.expired +
             " unrecognized=" + report.counts.unrecognized);
  lines.push("warnings=" + JSON.stringify(report.warnings));
  if (report.skipped.length) {
    lines.push("");
    lines.push("source\tposition\taccount\treason");
    for (const s of report.skipped) {
      lines.push([s.source, s.position, s.emailMasked || "-", s.reasons.join(",")].join("\t"));
    }
  }
  return lines.join("\n");
}

/* -------------------------------------------------------------------- wiring */

function wire() {
  for (const btn of document.querySelectorAll(".langs button")) {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  }

  const drop = $("drop");
  $("pick-files").addEventListener("click", (e) => { e.stopPropagation(); $("input-files").click(); });
  $("pick-folder").addEventListener("click", (e) => { e.stopPropagation(); $("input-folder").click(); });
  drop.addEventListener("click", () => $("input-files").click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("input-files").click(); }
  });

  for (const id of ["input-files", "input-folder"]) {
    $(id).addEventListener("change", async (e) => {
      await addFiles(e.target.files);
      e.target.value = "";
    });
  }

  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add("hot"); });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, () => drop.classList.remove("hot"));
  }
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) await addFiles(e.dataTransfer.files);
  });

  $("clear-files").addEventListener("click", () => {
    state.files = [];
    clearResult();
    renderFiles();
  });

  for (const group of ["target-choices", "mode-choices", "filter-choices", "invalid-choices"]) {
    $(group).addEventListener("change", () => {
      for (const label of $(group).querySelectorAll("label.choice")) {
        label.classList.toggle("on", label.querySelector("input").checked);
      }
      clearResult();
    });
  }
  $("label").addEventListener("input", clearResult);

  $("run").addEventListener("click", run);

  $("copy-report").addEventListener("click", async () => {
    const text = reportText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const btn = $("copy-report");
    btn.textContent = t(state.lang, "card3.copied");
    setTimeout(() => { btn.textContent = t(state.lang, "card3.copy"); }, 1500);
  });

  window.addEventListener("beforeunload", () => {
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  });
}

let stored = null;
try { stored = localStorage.getItem(LANG_KEY); } catch { stored = null; }
state.lang = stored && LANGS.includes(stored) ? stored : resolveLang(navigator.language);

wire();
applyLang();
