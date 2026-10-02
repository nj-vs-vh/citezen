"use strict";

const $ = (id) => document.getElementById(id);

// Accepts "10.x/y", "doi:10.x/y", or any URL containing a DOI.
function parseDoi(line) {
  const m = decodeURIComponent(line.trim()).match(/10\.\d{4,9}\/[^\s"<>]+/i);
  return m ? m[0].replace(/[.,;)\]]+$/, "") : null;
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

// Rewrites the citation key to e.g. smith2013first, mirroring doi2bib's readable keys.
function rekey(bib) {
  const field = (name) => {
    const m = bib.match(
      new RegExp("\\b" + name + '\\s*=\\s*[{"]+([^}"]*)', "i"),
    );
    return m ? m[1].trim() : "";
  };
  const author = field("author").split(/\s+and\s+/)[0];
  const family = author.includes(",")
    ? author.split(",")[0]
    : author.split(/\s+/).pop();
  const word =
    field("title")
      .split(/\s+/)
      .map(strip)
      .find((w) => w && !STOP.has(w.toLowerCase())) || "";
  const key = (strip(family) + field("year") + word).toLowerCase();
  return key ? bib.replace(/^(@\w+\s*\{)[^,]*,/, "$1" + key + ",") : bib;
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const status = $("status");
  const line = $("input").value.trim();
  status.textContent = "";
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
    let bib = await fetchBibtex(doi);
    if ($("shortkey").checked) bib = rekey(bib);
    $("output").value = bib;
    $("output").hidden = $("actions").hidden = false;
    status.textContent = "";
  } catch (e) {
    const d = document.createElement("div");
    d.className = "err";
    d.textContent = e instanceof TypeError ? "Network error" : e.message;
    status.replaceChildren(d);
  } finally {
    $("go").disabled = false;
  }
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
  a.download = "references.bib";
  a.click();
  URL.revokeObjectURL(a.href);
});
