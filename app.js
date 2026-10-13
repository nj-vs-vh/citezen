import { Cite } from "https://esm.sh/@citation-js/core@0.9.0";
import "https://esm.sh/@citation-js/plugin-bibtex@0.9.0";
import "https://esm.sh/@citation-js/plugin-csl@0.9.0";
import { formatSlides } from "./slides.js";

const $ = (id) => document.getElementById(id);

// Accepts a DOI ("10.x/y", "doi:...", doi.org URL) or an arXiv ID/URL
// (2507.10823, arXiv:2507.10823v2, arxiv.org/abs|pdf/..., hep-th/9901001).
// arXiv papers resolve through their DataCite DOI (10.48550/arXiv.<id>).
const ARXIV_ID = "(?:\\d{4}\\.\\d{4,5}|[a-z-]+(?:\\.[A-Z]{2})?/\\d{7})";
const ARXIV_RE = new RegExp(
  "^(?:(?:https?://)?(?:www\\.)?arxiv\\.org/(?:abs|pdf|html)/|arxiv:)?(" +
    ARXIV_ID +
    ")(?:v\\d+)?(?:\\.pdf)?/?(?:[?#].*)?$",
  "i",
);

function parseDoi(line) {
  line = line.trim();
  const m = decodeURIComponent(line).match(/10\.\d{4,9}\/[^\s"<>]+/i);
  if (m) return m[0].replace(/[.,;)\]]+$/, "");
  const a = line.match(ARXIV_RE);
  return a ? "10.48550/arXiv." + a[1] : null;
}

// Single source of truth: CSL-JSON from doi.org. BibTeX and quotes are generated from it.
async function fetchCsl(doi) {
  const res = await fetch("https://doi.org/" + encodeURI(doi), {
    headers: { Accept: "application/vnd.citationstyles.csl+json" },
    redirect: "follow",
  });
  if (res.status === 404) throw new Error("DOI not found");
  if (!res.ok) throw new Error("Lookup failed (HTTP " + res.status + ")");
  let item;
  try {
    item = await res.json();
  } catch {
    throw new Error("No metadata available for this DOI");
  }
  // Citation.js only keeps institutional authors given as `literal`.
  item.author = (item.author || []).map(({ name, ...a }) =>
    name ? { ...a, literal: name } : a,
  );
  return item;
}

const strip = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
const STOP = new Set([
  "a",
  "an",
  "the",
  "on",
  "of",
  "in",
  "and",
  "for",
  "to",
  "with",
]);

function capitalize(val) {
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

// Readable key like kucsko2013nanometrescale, built from parsed CSL-JSON.
function makeKey(item) {
  const a = (item.author || [])[0] || {};
  const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
  const word =
    (item.title || "")
      .split(/\s+/)
      .map(strip)
      .find((w) => w && !STOP.has(w.toLowerCase())) || "";
  return (
    capitalize(strip(a.family || a.literal || "")) + year + capitalize(word)
  );
}

// Settings: one JSON object in localStorage. To add a setting, add a default
// here and a control with a matching data-setting attribute in index.html.
const SETTINGS_KEY = "citezen.settings";
const DEFAULTS = {
  shortKey: true,
  style: "apa",
  userName: "",
  slidesEmoji: "📖",
  slidesFontSize: "11",
  slidesFontFamily: "Cardo, Times New Roman, serif",
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}
const settings = loadSettings();

for (const el of document.querySelectorAll("[data-setting]")) {
  const name = el.dataset.setting;
  const isCheck = el.type === "checkbox";
  if (isCheck) el.checked = !!settings[name];
  else el.value = settings[name];
  el.addEventListener("input", () => {
    settings[name] = isCheck ? el.checked : el.value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (shown) show(shown); // re-render the current output with new settings
  });
}

let csl = null; // CSL-JSON record for lastDoi
let lastDoi = null;
let shown = null; // mode currently displayed

function format(mode) {
  if (mode === "slides") {
    return formatSlides(csl, {
      userName: settings.userName,
      emoji: settings.slidesEmoji,
    });
  }
  const data = [structuredClone(csl)];
  if (settings.shortKey) {
    const key = makeKey(data[0]);
    if (key) data[0].id = data[0]["citation-key"] = key;
  }
  const c = new Cite(data);
  return mode === "bibtex"
    ? c.format("bibtex").trim()
    : c
        .format("bibliography", { format: "text", template: settings.style })
        .trim();
}

function setError(msg) {
  const d = document.createElement("div");
  d.className = "err";
  d.textContent = msg;
  $("status").replaceChildren(d);
}

const escapeHtml = (t) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Rich clipboard payload: Google Slides turns the HTML anchor into a hyperlink.
function slidesHtml(text) {
  const url = "https://doi.org/" + encodeURI(csl.DOI || lastDoi);
  // Only the size is set, so Slides keeps the font family of the target text box.
  const size = parseFloat(settings.slidesFontSize);
  const fontFamily = settings.slidesFontFamily;
  const style =
    size > 0 ? ` style="font-size:${size}pt; font-family: ${fontFamily};"` : "";
  return `<span${style}><a href="${escapeHtml(url)}">${escapeHtml(text)}</a></span>`;
}

async function copy(text, html) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    $("status").textContent = html
      ? "Copied to clipboard (with link)"
      : "Copied to clipboard";
  } catch {
    $("status").textContent =
      "Could not copy automatically; select and copy above";
  }
}

const copyButtons = [...document.querySelectorAll("button[data-mode]")];

// Copy buttons are only usable while the input still matches the fetched entry.
function syncCopyButtons() {
  const ready = csl && parseDoi($("input").value) === lastDoi;
  copyButtons.forEach((b) => (b.disabled = !ready));
}

function show(mode) {
  shown = mode;
  $("output").value = format(mode);
  $("output").hidden = false;
}

$("input").addEventListener("input", syncCopyButtons);

for (const b of copyButtons) {
  b.addEventListener("click", () => {
    show(b.dataset.mode);
    const text = $("output").value;
    copy(text, b.dataset.mode === "slides" ? slidesHtml(text) : null);
  });
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const line = $("input").value.trim();
  if (!line) return;

  const doi = parseDoi(line);
  if (!doi) {
    setError("Not a valid DOI or arXiv ID");
    return;
  }

  $("fetch").disabled = true;
  try {
    $("status").textContent = "Fetching…";
    csl = await fetchCsl(doi);
    lastDoi = doi;
    show(shown ?? "bibtex");
    $("status").textContent = "Fetched";
  } catch (e) {
    csl = lastDoi = shown = null;
    $("output").hidden = true;
    setError(e instanceof TypeError ? "Network error" : e.message);
  } finally {
    $("fetch").disabled = false;
    syncCopyButtons();
  }
});
