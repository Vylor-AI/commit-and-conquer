const fs = require("fs");
const path = require("path");

const OTHERS_NAME = "Others";

function sumChanges(changes) {
  if (changes && typeof changes === "object") {
    return {
      added: Number(changes.added) || 0,
      removed: Number(changes.removed) || 0,
    };
  }
  return { added: Number(changes) || 0, removed: 0 };
}

function toUnixSeconds(dateString) {
  const ms = new Date(dateString).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function rankAuthors(readCheckpoints, maxAuthors, includeOthers = false) {
  const peak = new Map();
  let steps = 0;

  for (const checkpoint of readCheckpoints()) {
    steps += 1;
    for (const [author, loc] of Object.entries(checkpoint.scores || {})) {
      if (loc > (peak.get(author) || 0)) peak.set(author, loc);
    }
  }

  const ranked = Array.from(peak.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([author]) => author);

  const keepCount = Math.max(1, maxAuthors);
  const hasOverflow = includeOthers && ranked.length > keepCount;
  // Reserve one slot for "Others" only when overflow folding is enabled.
  const kept = hasOverflow
    ? ranked.slice(0, keepCount - 1)
    : ranked.slice(0, keepCount);
  return { kept, hasOverflow, totalAuthors: ranked.length, steps };
}

function buildCompactV2({
  readCheckpoints,
  repoLabel,
  repoSlug,
  sha = null,
  maxAuthors = 100,
  maxSteps = 3000,
  includeOthers = false,
  generatedAt = new Date().toISOString(),
}) {
  const { kept, hasOverflow, totalAuthors, steps } = rankAuthors(
    readCheckpoints,
    maxAuthors,
    includeOthers
  );

  const authorIndex = new Map(kept.map((name, idx) => [name, idx]));
  const authors = kept.map((name) => ({ n: name }));
  let othersIdx = -1;
  if (hasOverflow) {
    othersIdx = authors.length;
    authors.push({ n: OTHERS_NAME });
  }

  const idxFor = (name) =>
    authorIndex.has(name) ? authorIndex.get(name) : othersIdx;

  const groupSize = Math.max(1, Math.ceil(steps / Math.max(1, maxSteps)));
  const out = [];

  // Running state of what the *previous emitted step* looked like, so we only
  // write authors whose folded score changed.
  const lastEmitted = new Array(authors.length).fill(0);

  let group = null;
  let groupCount = 0;

  function emitGroup() {
    if (!group) return;

    const folded = new Array(authors.length).fill(0);
    for (const [name, loc] of Object.entries(group.lastScores)) {
      const idx = idxFor(name);
      if (idx >= 0) folded[idx] += loc;
    }

    const changed = [];
    let biggestGain = 0;
    let committerIdx = group.committerIdx;
    for (let i = 0; i < folded.length; i += 1) {
      if (folded[i] !== lastEmitted[i]) {
        changed.push([i, folded[i]]);
        const gain = folded[i] - lastEmitted[i];
        if (gain > biggestGain) {
          biggestGain = gain;
          committerIdx = i;
        }
        lastEmitted[i] = folded[i];
      }
    }

    // For merged groups the last commit's author may not be the main
    // contributor; prefer whoever gained the most surviving lines.
    if (groupCount === 1) committerIdx = group.committerIdx;

    out.push([
      group.ts,
      committerIdx < 0 ? -1 : committerIdx,
      group.added,
      group.removed,
      changed,
    ]);
    group = null;
    groupCount = 0;
  }

  for (const checkpoint of readCheckpoints()) {
    const ts = toUnixSeconds(checkpoint.date);
    if (ts === null) continue;

    const changes = sumChanges(checkpoint.changes);
    if (!group) {
      group = {
        ts,
        added: 0,
        removed: 0,
        committerIdx: -1,
        lastScores: {},
      };
    }

    group.ts = ts;
    group.added += changes.added;
    group.removed += changes.removed;
    group.committerIdx = idxFor(checkpoint.committer);
    group.lastScores = checkpoint.scores || {};
    groupCount += 1;

    if (groupCount >= groupSize) emitGroup();
  }
  emitGroup();

  // Timeline must be chronological for the game's date sort to be stable.
  out.sort((a, b) => a[0] - b[0]);

  return {
    v: 2,
    repo: repoSlug || repoLabel,
    label: repoLabel,
    generatedAt,
    sha,
    stats: {
      commits: steps,
      steps: out.length,
      authorsTotal: totalAuthors,
      authorsShown: authors.length,
    },
    authors,
    steps: out,
  };
}

function writeCompactV2File(outputFile, payload) {
  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  // One step per line keeps the file diffable and easy to stream-inspect.
  const head = JSON.stringify({ ...payload, steps: undefined }).slice(0, -1);
  const body = payload.steps.map((s) => JSON.stringify(s)).join(",\n");
  fs.writeFileSync(outputFile, `${head},"steps":[\n${body}\n]}\n`, "utf8");
}

function* iterateCheckpointFiles(storage, repoKey) {
  const dir = storage.checkpointsDir(repoKey);
  if (!fs.existsSync(dir)) return;

  const files = fs
    .readdirSync(dir)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  for (const name of files) {
    const checkpoint = storage.readJson(path.join(dir, name), null);
    if (checkpoint) yield checkpoint;
  }
}

module.exports = {
  OTHERS_NAME,
  buildCompactV2,
  writeCompactV2File,
  iterateCheckpointFiles,
};
