import { Cite } from "https://esm.sh/@citation-js/core@0.9.0";
import "https://esm.sh/@citation-js/plugin-bibtex@0.9.0";
import "https://esm.sh/@citation-js/plugin-csl@0.9.0";

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

async function fetchBibtex(doi) {
  const res = await fetch("https://doi.org/" + encodeURI(doi), {
    headers: { Accept: "application/x-bibtex; charset=utf-8" },
    redirect: "follow",
  });
  if (res.status === 404) throw new Error("DOI not found");
  if (!res.ok) throw new Error("Lookup failed (HTTP " + res.status + ")");
  const text = (await res.text()).trim();
  if (!text.startsWith("@"))
    throw new Error("No BibTeX available for this DOI");
  return text;
}

const strip = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
const STOP = new Set(["a", "an", "the", "on", "of", "in", "and", "for", "to", "with"]);

// Readable key like kucsko2013nanometrescale, built from parsed CSL-JSON.
function makeKey(item) {
  const a = (item.author || [])[0] || {};
  const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "";
  const word = (item.title || "")
    .split(/\s+/)
    .map(strip)
    .find((w) => w && !STOP.has(w.toLowerCase())) || "";
  return (strip(a.family || a.literal || "") + year + word).toLowerCase();
}

let cite = null; // current parsed entry

function render() {
  if (!cite) return;
  const mode = $("mode").value;
  $("style").hidden = mode !== "citation";
  $("output").value =
    mode === "bibtex"
      ? cite.format("bibtex")
      : cite.format("bibliography", { format: "text", template: $("style").value }).trim();
  $("output").hidden = $("actions").hidden = false;
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const status = $("status");
  const line = $("input").value.trim();
  status.textContent = "";
  cite = null;
  $("output").hidden = $("actions").hidden = true;
  if (!line) return;

  const doi = parseDoi(line);
  if (!doi) {
    status.innerHTML = '<div class="err">Not a valid DOI</div>';
    return;
  }

  $("go").disabled = true;
  status.textContent = "Fetching…";
  try {
    cite = new Cite(await fetchBibtex(doi));
    if ($("shortkey").checked) {
      const key = makeKey(cite.data[0]);
      if (key) cite.data[0].id = cite.data[0]["citation-key"] = key;
    }
    render();
    status.textContent = "";
  } catch (e) {
    cite = null;
    const d = document.createElement("div");
    d.className = "err";
    d.textContent = e instanceof TypeError ? "Network error" : e.message;
    status.replaceChildren(d);
  } finally {
    $("go").disabled = false;
  }
});

for (const id of ["mode", "style"]) $(id).addEventListener("change", render);
$("shortkey").addEventListener("change", () => {
  if ($("input").value.trim()) $("form").requestSubmit();
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("output").value);
  $("copy").textContent = "Copied!";
  setTimeout(() => ($("copy").textContent = "Copy"), 1200);
});

$("download").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([$("output").value + "\n"], { type: "text/plain" }),
  );
  a.download = $("mode").value === "bibtex" ? "references.bib" : "citation.txt";
  a.click();
  URL.revokeObjectURL(a.href);
});
