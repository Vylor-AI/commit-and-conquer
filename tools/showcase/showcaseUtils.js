const fs = require("fs");

const REPO_SLUG_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

function parseRepoSlug(slug) {
  if (typeof slug !== "string") {
    throw new Error(`Invalid repository slug: ${String(slug)}`);
  }
  const trimmed = slug.trim();
  const match = trimmed.match(REPO_SLUG_RE);
  if (!match) {
    throw new Error(
      `Invalid repository slug "${slug}". Expected "owner/name".`
    );
  }
  const owner = match[1];
  const name = match[2];
  return {
    owner,
    name,
    slug: `${owner}/${name}`,
    id: `${owner}-${name}`.replace(/[^A-Za-z0-9_.-]/g, "-"),
  };
}

function loadShowcaseConfig(configPath, onlyRepo = "") {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("showcase/repos.json must be an array.");
  }

  const filterSlug = String(onlyRepo || "").trim().toLowerCase();
  const entries = [];
  const seen = new Set();

  for (const item of raw) {
    if (!item || typeof item !== "object" || !item.repo) {
      throw new Error("Each entry in showcase/repos.json needs a 'repo' field.");
    }
    const parsed = parseRepoSlug(item.repo);
    const key = parsed.slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (filterSlug && key !== filterSlug && parsed.id.toLowerCase() !== filterSlug) {
      continue;
    }

    entries.push({
      ...parsed,
      ref: typeof item.ref === "string" && item.ref.trim() ? item.ref.trim() : null,
      since:
        typeof item.since === "string" && item.since.trim()
          ? item.since.trim()
          : null,
      maxAuthors: Number.isInteger(item.maxAuthors) ? item.maxAuthors : 100,
      maxSteps: Number.isInteger(item.maxSteps) ? item.maxSteps : 3000,
      description:
        typeof item.description === "string" ? item.description.trim() : "",
    });
  }

  return entries;
}

function isoDatePrefix(unixSeconds) {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n)) return "";
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function extractTimelineSummary(v2Payload) {
  const steps = Array.isArray(v2Payload && v2Payload.steps)
    ? v2Payload.steps
    : [];
  const stats = (v2Payload && v2Payload.stats) || {};
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];

  return {
    commits: Number(stats.commits) || steps.length,
    contributors:
      Number(stats.authorsTotal) ||
      (Array.isArray(v2Payload && v2Payload.authors)
        ? v2Payload.authors.length
        : 0),
    firstCommit: firstStep ? isoDatePrefix(firstStep[0]) : "",
    lastCommit: lastStep ? isoDatePrefix(lastStep[0]) : "",
    sha: (v2Payload && v2Payload.sha) || null,
  };
}

function buildRepoMetadataRecord({
  entry,
  v2Payload,
  rawBytes,
  githubMeta = null,
}) {
  const summary = extractTimelineSummary(v2Payload);
  const gh = githubMeta && typeof githubMeta === "object" ? githubMeta : {};

  return {
    id: entry.id,
    owner: entry.owner,
    name: entry.name,
    description: entry.description || gh.description || "",
    url: gh.html_url || `https://github.com/${entry.owner}/${entry.name}`,
    stars: Number.isFinite(Number(gh.stargazers_count))
      ? Number(gh.stargazers_count)
      : null,
    language: gh.language || null,
    commits: summary.commits,
    contributors: summary.contributors,
    firstCommit: summary.firstCommit,
    lastCommit: summary.lastCommit,
    sha: summary.sha,
    file: `${entry.id}.json`,
    rawBytes: Number(rawBytes) || 0,
    avatar:
      (gh.owner && gh.owner.avatar_url) ||
      `https://github.com/${encodeURIComponent(entry.owner)}.png?size=64`,
  };
}

function assertNoEmails(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.includes("@")) {
    throw new Error(
      `Privacy guard failed: '@' found in showcase artifact ${filePath}`
    );
  }
}

function assembleShowcaseIndex({
  configEntries,
  repoMetasById,
  previousIndex = null,
  fileExists = () => true,
  generatedAt = new Date().toISOString(),
}) {
  const prevById = new Map();
  if (previousIndex && Array.isArray(previousIndex.repos)) {
    for (const prev of previousIndex.repos) {
      if (prev && prev.id) prevById.set(prev.id, prev);
    }
  }

  const repos = [];
  for (const entry of configEntries) {
    const fresh = repoMetasById[entry.id];
    const fallback = prevById.get(entry.id);
    if (fresh && fileExists(fresh.file)) {
      if (fallback) {
        if (!fresh.description && fallback.description) {
          fresh.description = fallback.description;
        }
        if (fresh.stars === null && fallback.stars !== null) {
          fresh.stars = fallback.stars;
        }
        if (!fresh.language && fallback.language) {
          fresh.language = fallback.language;
        }
      }
      repos.push(fresh);
      continue;
    }

    if (fallback && fallback.file && fileExists(fallback.file)) {
      repos.push(fallback);
    }
  }

  return { generatedAt, repos };
}

module.exports = {
  parseRepoSlug,
  loadShowcaseConfig,
  extractTimelineSummary,
  buildRepoMetadataRecord,
  assertNoEmails,
  assembleShowcaseIndex,
};
