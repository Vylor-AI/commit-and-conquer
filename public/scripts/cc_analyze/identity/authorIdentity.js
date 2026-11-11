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

function buildAuthorNormalizer(rawAuthors) {
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
