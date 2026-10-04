// Abbreviated "slide" citations, e.g. "📖 Evoli et al (KG), 18'".
// Works on CSL-JSON items. doi.org's BibTeX drops collaboration names, so
// callers should pass the CSL-JSON record when available.

const MAX_NAMES = 3;

const norm = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const lastToken = (s) => norm(s).split(/[\s-]+/).filter(Boolean).pop() || "";
// Family initial followed by given-name initials: "Kucsko, G." -> "KG".
const initials = (a) =>
  [...(a.given || "").split(/[\s.\-]+/), a.family || ""]
    .map((p) => norm(p)[0]?.toUpperCase() || "")
    .join("");

function isCollab(a) {
  return !a.family && /collab/i.test(a.name || a.literal || "");
}

// "Pierre Auger Collaboration" -> "Pierre Auger Coll."; "IceCube Collaboration" -> "IceCube".
function collabLabel(a) {
  const base = (a.name || a.literal)
    .replace(/^the\s+/i, "")
    .replace(/[\s,]*collab(oration)?\.?$/i, "")
    .trim();
  return /\s/.test(base) ? base + " Coll." : base;
}

// Accepts "Family, Given", "Given Family" or just "Family".
function parseUser(name) {
  name = (name || "").trim();
  if (!name) return null;
  let family, given;
  if (name.includes(",")) [family, given = ""] = name.split(",").map((s) => s.trim());
  else {
    const parts = name.split(/\s+/);
    family = parts.pop();
    given = parts.join(" ");
  }
  return { family: lastToken(family), initial: norm(given)[0] || "" };
}

function isUser(a, user) {
  if (!user || !a.family || lastToken(a.family) !== user.family) return false;
  return !user.initial || !a.given || norm(a.given)[0] === user.initial;
}

export function formatSlides(item, { userName = "", emoji = "📖" } = {}) {
  const authors = item.author || [];
  const user = parseUser(userName);
  const label = (a) => (isUser(a, user) ? initials(a) : a.family || a.name || a.literal || "");
  const mine = authors.filter((a) => isUser(a, user));
  const myTag = mine.length ? initials(mine[0]) : "";

  const collab = authors.find(isCollab);
  let names;
  if (collab) {
    names = collabLabel(collab) + (myTag ? ` (+${myTag})` : "");
  } else if (authors.length > MAX_NAMES) {
    names = label(authors[0]) + " et al";
    if (myTag && !isUser(authors[0], user)) names += ` (+${myTag})`;
  } else {
    names = authors.map(label).join(", ");
  }

  const year = item.issued?.["date-parts"]?.[0]?.[0];
  const yy = year ? `’${String(year).slice(-2)}` : "";
  return [emoji, [names || "Unknown", yy].filter(Boolean).join(", ")].join(" ").trim();
}
