function sanitizeToken(token) {
  if (!token) {
    return "";
  }

  return token.replace(/[^a-zA-Z0-9]/g, "");
}

function toTitleCase(value) {
  if (!value) {
    return "Unknown";
  }

  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitName(raw) {
  const normalized = (raw || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { first: "Unknown", lastInitial: "" };
  }

  const parts = normalized
    .split(" ")
    .map(sanitizeToken)
    .filter(Boolean);

  if (parts.length === 0) {
    return { first: "Unknown", lastInitial: "" };
  }

  const first = toTitleCase(parts[0]);
  const lastInitial =
    parts.length > 1 ? toTitleCase(parts[parts.length - 1]).charAt(0) : "";

  return { first, lastInitial };
}

function stripEmail(raw) {
  return String(raw || "")
    .replace(/\s*<[^>]*>\s*$/, "")
    .trim()
    .replace(/\s+/g, " ");
}

// Full-name style: "Jane Doe <jane@x.com>" and blame's "Jane Doe" both map to
// "Jane Doe". Emails are dropped so they can never reach published output.
// Case variants (e.g. "TJ Holowaychuk" vs "Tj Holowaychuk") unify to the most
// common spelling in the repository.
function buildFullNameNormalizer(rawAuthors) {
  const countsByLower = new Map();

  for (const raw of new Set(rawAuthors || [])) {
    if (typeof raw !== "string") continue;
    const cleaned = stripEmail(raw);
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    let counts = countsByLower.get(lower);
    if (!counts) {
      counts = new Map();
      countsByLower.set(lower, counts);
    }
    counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
  }

  const canonicalByLower = new Map();
  for (const [lower, counts] of countsByLower.entries()) {
    let best = "";
    let bestCount = -1;
    for (const [variant, count] of counts.entries()) {
      if (count > bestCount || (count === bestCount && variant < best)) {
        best = variant;
        bestCount = count;
      }
    }
    if (best) canonicalByLower.set(lower, best);
  }

  function normalize(raw) {
    const cleaned = stripEmail(raw);
    if (!cleaned) return "Unknown";
    return canonicalByLower.get(cleaned.toLowerCase()) || cleaned;
  }
  return { normalize, mapping: {} };
}

function buildAuthorNormalizer(rawAuthors, options = {}) {
  if (options.style === "full") {
    return buildFullNameNormalizer(rawAuthors);
  }

  const uniqueRaw = Array.from(
    new Set((rawAuthors || []).filter((name) => typeof name === "string"))
  ).sort((a, b) => a.localeCompare(b));

  const firstNameCounts = {};
  const byRaw = {};

  for (const raw of uniqueRaw) {
    const parts = splitName(raw);
    byRaw[raw] = parts;
    firstNameCounts[parts.first] = (firstNameCounts[parts.first] || 0) + 1;
  }

  const mapping = {};
  const used = {};

  for (const raw of uniqueRaw) {
    const parts = byRaw[raw];
    let candidate = parts.first;

    if (firstNameCounts[parts.first] > 1 && parts.lastInitial) {
      candidate = `${parts.first} ${parts.lastInitial}`;
    }

    if (used[candidate]) {
      let suffix = 2;
      while (used[`${candidate}${suffix}`]) {
        suffix += 1;
      }
      candidate = `${candidate}${suffix}`;
    }

    used[candidate] = true;
    mapping[raw] = candidate;
  }

  function normalize(raw) {
    if (mapping[raw]) {
      return mapping[raw];
    }

    const parts = splitName(raw);
    return parts.first;
  }

  return { normalize, mapping };
}

module.exports = {
  buildAuthorNormalizer,
};
