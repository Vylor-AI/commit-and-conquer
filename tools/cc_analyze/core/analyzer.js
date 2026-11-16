const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const { LocalGitAdapter } = require("../git/localGitAdapter");
const { FsStorageAdapter } = require("../storage/fsStorageAdapter");
const { buildAuthorNormalizer } = require("../identity/authorIdentity");
const { isAnalyzableFile } = require("../domain/fileFilters");
const {
  buildCompactV2,
  writeCompactV2File,
  iterateCheckpointFiles,
} = require("./compactExporter");

const BLAME_WORKER_PATH = path.join(__dirname, "blameWorker.js");

function applyCounts(target, counts, sign) {
  if (!counts) return;
  for (const [author, value] of Object.entries(counts)) {
    const next = (target[author] || 0) + sign * value;
    if (next <= 0) {
      delete target[author];
    } else {
      target[author] = next;
    }
  }
}

function cloneScores(scores) {
  if (!scores) return {};
  const clone = {};
  for (const [author, val] of Object.entries(scores)) {
    clone[author] = val;
  }
  return clone;
}

function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0ms";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function estimateRemainingMs(completed, total, elapsedMs) {
  if (completed <= 0 || elapsedMs <= 0 || total <= completed) return 0;
  const ratePerUnitMs = elapsedMs / completed;
  return Math.max(0, Math.round((total - completed) * ratePerUnitMs));
}

function logRepositoryProgress(repoName, completed, total, startedAtMs) {
  const elapsedMs = Date.now() - startedAtMs;
  const remainingMs = estimateRemainingMs(completed, total, elapsedMs);
  const commitsPerSec =
    elapsedMs > 0 ? (completed / (elapsedMs / 1000)).toFixed(2) : "0.00";

  console.log(
    `⏳ [${repoName}] ${completed}/${total} commits | elapsed=${formatDurationMs(elapsedMs)} | eta=${formatDurationMs(remainingMs)} | rate=${commitsPerSec} commits/s`
  );
}

function logTaskResolutionProgress(
  repoName,
  completed,
  total,
  startedAtMs,
  runtime = null
) {
  const elapsedMs = Date.now() - startedAtMs;
  const remainingMs = estimateRemainingMs(completed, total, elapsedMs);
  const tasksPerSec =
    elapsedMs > 0 ? (completed / (elapsedMs / 1000)).toFixed(2) : "0.00";

  const parts = [
    `🧵 [${repoName}] ${completed}/${total} ownership tasks`,
    `elapsed=${formatDurationMs(elapsedMs)}`,
    `eta=${formatDurationMs(remainingMs)}`,
    `rate=${tasksPerSec} tasks/s`,
  ];

  if (runtime) {
    parts.push(`inFlight=${runtime.inFlight}`);
    parts.push(`remaining=${runtime.remaining}`);
    parts.push(`avgTask=${formatDurationMs(runtime.avgTaskMs)}`);
  }

  console.log(parts.join(" | "));
}

function createRepositoryMetrics() {
  return {
    gitRichCommitsMs: 0,
    gitCommitHistoryChangesMapMs: 0,
    ownershipPreResolveMs: 0,
    timelineProcessingMs: 0,
    ownership: {
      resolveCalls: 0,
      resolveTotalMs: 0,
      cacheHits: 0,
      cacheHitReadMs: 0,
      cacheMisses: 0,
      blameCalls: 0,
      blameMs: 0,
      saveCalls: 0,
      saveMs: 0,
    },
  };
}

function logRepositoryMetrics(repoName, metrics) {
  console.log(
    `📊 [${repoName}] phases | richCommits=${formatDurationMs(metrics.gitRichCommitsMs)} | mutationMap=${formatDurationMs(metrics.gitCommitHistoryChangesMapMs)} | preResolve=${formatDurationMs(metrics.ownershipPreResolveMs)} | timeline=${formatDurationMs(metrics.timelineProcessingMs)}`
  );

  const ownership = metrics.ownership;
  console.log(
    `📊 [${repoName}] ownership | resolves=${ownership.resolveCalls} (${formatDurationMs(ownership.resolveTotalMs)}) | cacheHits=${ownership.cacheHits} (${formatDurationMs(ownership.cacheHitReadMs)}) | cacheMisses=${ownership.cacheMisses} | blameCalls=${ownership.blameCalls} (${formatDurationMs(ownership.blameMs)}) | saves=${ownership.saveCalls} (${formatDurationMs(ownership.saveMs)})`
  );
}

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) {
    return [];
  }

  const maxWorkers = Math.max(1, Math.floor(limit));
  const workerCount = Math.min(maxWorkers, items.length);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function runBlameWorker({ repoPath, commitHash, filePath }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(BLAME_WORKER_PATH, {
      workerData: { repoPath, commitHash, filePath },
    });

    worker.on("message", (message) => {
      if (message && message.error) {
        reject(new Error(message.error));
        return;
      }
      resolve(message ? message.ownership : null);
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Blame worker exited with code ${code}`));
      }
    });
  });
}

function normalizeOwnership(ownership, normalizeAuthor) {
  if (!ownership || !ownership.counts) return null;
  const normalizedCounts = {};
  for (const [rawAuthor, value] of Object.entries(ownership.counts)) {
    const normalized = normalizeAuthor(rawAuthor);
    normalizedCounts[normalized] = (normalizedCounts[normalized] || 0) + value;
  }
  return { ...ownership, counts: normalizedCounts };
}

async function blameFile({ repoPath, commitHash, filePath, git, warnings }) {
  try {
    if (
      git &&
      git.gitBackend !== "nodegit" &&
      typeof git.blameFileAtCommitWithCliAsync === "function"
    ) {
      return await git.blameFileAtCommitWithCliAsync(
        repoPath,
        commitHash,
        filePath
      );
    }
    return await runBlameWorker({ repoPath, commitHash, filePath });
  } catch (error) {
    warnings.push(
      `Blame worker failed for ${filePath} at ${commitHash.slice(0, 8)}: ${error.message || String(error)}`
    );
    return null;
  }
}

async function resolveOwnershipForCommitFile({
  repoKey,
  repoPath,
  git,
  storage,
  filePath,
  commitHash,
  warnings,
  normalizeAuthor,
  metrics,
}) {
  const ownershipMetrics = metrics.ownership;
  const resolveStartedAtMs = Date.now();
  ownershipMetrics.resolveCalls += 1;

  try {
    let ownership = null;
    const cacheReadStartedAtMs = Date.now();
    ownership = storage.loadFileOwnership(repoKey, filePath, commitHash);
    const cacheReadMs = Date.now() - cacheReadStartedAtMs;

    if (ownership) {
      ownershipMetrics.cacheHits += 1;
      ownershipMetrics.cacheHitReadMs += cacheReadMs;
    } else {
      ownershipMetrics.cacheMisses += 1;

      ownershipMetrics.blameCalls += 1;
      const blameStartedAtMs = Date.now();
      ownership = await blameFile({
        repoPath,
        commitHash,
        filePath,
        git,
        warnings,
      });
      ownershipMetrics.blameMs += Date.now() - blameStartedAtMs;

      if (ownership) {
        ownershipMetrics.saveCalls += 1;
        const saveStartedAtMs = Date.now();
        storage.saveFileOwnership(repoKey, filePath, ownership, commitHash);
        ownershipMetrics.saveMs += Date.now() - saveStartedAtMs;
      }
    }

    if (!ownership) {
      return null;
    }

    return normalizeOwnership(ownership, normalizeAuthor);
  } finally {
    ownershipMetrics.resolveTotalMs += Date.now() - resolveStartedAtMs;
  }
}

function collectOwnershipTasks({
  repoPath,
  git,
  commits,
  startIndex,
  commitHistoryChangesMap,
}) {
  const tasks = [];
  const seen = new Set();

  function addTask(commitHash, filePath) {
    if (!filePath || !isAnalyzableFile(filePath)) {
      return;
    }

    const key = `${commitHash}::${filePath}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    tasks.push({ commitHash, filePath });
  }

  for (let idx = startIndex; idx < commits.length; idx += 1) {
    const commit = commits[idx];

    if (idx === 0) {
      const files = git.listFilesAtCommit(repoPath, commit.hash);
      for (const filePath of files) {
        addTask(commit.hash, filePath);
      }
      continue;
    }

    const changes = commitHistoryChangesMap.get(commit.hash) || [];
    for (const change of changes) {
      if (change.type === "D") {
        continue;
      }

      const newPath = change.type === "R" ? change.newPath : change.path;
      addTask(commit.hash, newPath);
    }
  }

  return tasks;
}

async function warmOwnershipCache({
  repoName,
  repoKey,
  repoPath,
  git,
  storage,
  tasks,
  fileWorkers,
  warnings,
  normalizeAuthor,
  metrics,
}) {
  if (!tasks.length) {
    console.log(`🧵 [${repoName}] No ownership tasks to pre-resolve.`);
    return;
  }

  const startedAtMs = Date.now();
  const progressInterval = 500;
  let completed = 0;
  let inFlight = 0;
  let totalTaskLatencyMs = 0;

  console.log(
    `🧵 [${repoName}] Pre-resolving ${tasks.length} ownership tasks (fileWorkers=${fileWorkers})...`
  );

  await mapWithConcurrency(tasks, fileWorkers, async (task) => {
    inFlight += 1;
    const taskStartedAtMs = Date.now();

    try {
      await resolveOwnershipForCommitFile({
        repoKey,
        repoPath,
        git,
        storage,
        filePath: task.filePath,
        commitHash: task.commitHash,
        warnings,
        normalizeAuthor,
        metrics,
      });
    } finally {
      const taskLatencyMs = Date.now() - taskStartedAtMs;
      totalTaskLatencyMs += taskLatencyMs;
      inFlight -= 1;
      completed += 1;

      if (completed % progressInterval === 0 || completed === tasks.length) {
        const avgTaskMs = completed > 0 ? totalTaskLatencyMs / completed : 0;
        logTaskResolutionProgress(repoName, completed, tasks.length, startedAtMs, {
          inFlight,
          remaining: tasks.length - completed,
          avgTaskMs,
        });
      }
    }
  });

  console.log(
    `🧵 [${repoName}] Ownership pre-resolution completed in ${formatDurationMs(Date.now() - startedAtMs)}`
  );
}

function findResumableCheckpoint(storage, repoKey) {
  const dir = storage.checkpointsDir(repoKey);
  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort();

  for (let i = files.length - 1; i >= 0; i -= 1) {
    const cp = storage.readJson(path.join(dir, files[i]), null);
    if (cp && cp.activeFileStates) {
      return cp;
    }
  }
  return null;
}

async function analyzeSingleRepository({
  repoPath,
  git,
  storage,
  fileWorkers,
  debug,
  authorStyle = "short",
  since = null,
  cacheKey = null,
}) {
  const startTime = Date.now();
  const repoName = path.basename(repoPath);
  const repoKey = cacheKey ? storage.hashKey(cacheKey) : storage.repoKey(repoPath);
  const warnings = [];
  const metrics = createRepositoryMetrics();

  const richCommitsStartedAtMs = Date.now();
  const commits =
    typeof git.getRichCommitsAsync === "function"
      ? await git.getRichCommitsAsync(repoPath, isAnalyzableFile, { since })
      : git.getRichCommits(repoPath, isAnalyzableFile);
  metrics.gitRichCommitsMs = Date.now() - richCommitsStartedAtMs;
  const totalCommits = commits.length;

  if (totalCommits === 0) {
    console.log(`ℹ️ [${repoName}] No analyzable commits found.`);
    logRepositoryMetrics(repoName, metrics);
    return { repoName, checkpoints: [], warnings, metrics };
  }

  const rawAuthors = git
    .getAllAuthors(repoPath)
    .concat(commits.map((commit) => commit.committerRaw));
  const authorIdentity = buildAuthorNormalizer(rawAuthors, {
    style: authorStyle,
  });
  const normalizeAuthor = authorIdentity.normalize;

  storage.ensureRepo(repoKey);
  const existingMeta = storage.readJson(storage.metaFile(repoKey), null);
  const sameConfig =
    existingMeta &&
    (existingMeta.authorStyle || "short") === authorStyle &&
    (existingMeta.since || null) === (since || null);
  const latest = sameConfig ? findResumableCheckpoint(storage, repoKey) : null;

  let startIndex = 0;
  let repoScores = {};
  const activeFileStates = new Map();

  if (
    latest &&
    Number.isInteger(latest.index) &&
    commits[latest.index] &&
    commits[latest.index].hash === latest.commitHash
  ) {
    startIndex = latest.index + 1;
    repoScores = cloneScores(latest.repoScores || latest.scores);

    if (latest.activeFileStates) {
      for (const [fPath, ownership] of Object.entries(
        latest.activeFileStates
      )) {
        activeFileStates.set(fPath, ownership);
      }
    }

    if (startIndex < totalCommits) {
      console.log(
        `♻️ [${repoName}] Resuming seamlessly from commit ${startIndex + 1}/${totalCommits}.`
      );
    } else {
      console.log(`Base data [${repoName}] already generated up to date.`);
      logRepositoryMetrics(repoName, metrics);
      return { repoName, checkpoints: [], warnings, metrics };
    }
  } else {
    storage.resetRepo(repoKey);
    storage.ensureRepo(repoKey);
    storage.saveMeta(repoKey, {
      repo: repoName,
      repoPath,
      authorStyle,
      since: since || null,
      authorMap: authorIdentity.mapping,
      generatedAt: new Date().toISOString(),
    });
  }

  console.log(`🔍 [${repoName}] Querying file mutations via git adapter...`);
  const historyChangesStartedAtMs = Date.now();
  const commitHistoryChangesMap =
    typeof git.getCommitHistoryChangesMapAsync === "function"
      ? await git.getCommitHistoryChangesMapAsync(repoPath)
      : git.getCommitHistoryChangesMap(repoPath);
  metrics.gitCommitHistoryChangesMapMs =
    Date.now() - historyChangesStartedAtMs;

  const ownershipTasks = collectOwnershipTasks({
    repoPath,
    git,
    commits,
    startIndex,
    commitHistoryChangesMap,
  });

  const preResolveStartedAtMs = Date.now();
  await warmOwnershipCache({
    repoName,
    repoKey,
    repoPath,
    git,
    storage,
    tasks: ownershipTasks,
    fileWorkers,
    warnings,
    normalizeAuthor,
    metrics,
  });
  metrics.ownershipPreResolveMs = Date.now() - preResolveStartedAtMs;

  console.log(
    `🚀 [${repoName}] Processing timeline updates (fileWorkers=${fileWorkers})...`
  );

  const timelineStartedAtMs = Date.now();

  for (let idx = startIndex; idx < commits.length; idx += 1) {
    const commit = commits[idx];

    if (idx === 0) {
      const files = git
        .listFilesAtCommit(repoPath, commit.hash)
        .filter(isAnalyzableFile);

      const ownershipByFile = await mapWithConcurrency(
        files,
        fileWorkers,
        async (filePath) => {
          const normalizedOwnership = await resolveOwnershipForCommitFile({
            repoKey,
            repoPath,
            git,
            storage,
            filePath,
            commitHash: commit.hash,
            warnings,
            normalizeAuthor,
            metrics,
          });

          return {
            filePath,
            ownership: normalizedOwnership,
          };
        }
      );

      for (const entry of ownershipByFile) {
        if (!entry || !entry.ownership) {
          continue;
        }
        applyCounts(repoScores, entry.ownership.counts, +1);
        activeFileStates.set(entry.filePath, entry.ownership);
      }
    } else {
      const changes = commitHistoryChangesMap.get(commit.hash) || [];
      const pendingRebuilds = [];

      for (const change of changes) {
        if (change.type === "D") {
          const deletedOwnership = activeFileStates.get(change.path);
          if (deletedOwnership) {
            applyCounts(repoScores, deletedOwnership.counts, -1);
            activeFileStates.delete(change.path);
          }
          continue;
        }

        const newPath = change.type === "R" ? change.newPath : change.path;
        const trackedExistingPath =
          change.type === "R" ? change.oldPath : newPath;
        const oldOwnership = activeFileStates.get(trackedExistingPath);

        if (oldOwnership) {
          applyCounts(repoScores, oldOwnership.counts, -1);
          activeFileStates.delete(trackedExistingPath);
        }

        if (!newPath || !isAnalyzableFile(newPath)) {
          continue;
        }

        pendingRebuilds.push({ newPath });
      }

      const rebuiltOwnership = await mapWithConcurrency(
        pendingRebuilds,
        fileWorkers,
        async (item) => {
          const normalizedOwnership = await resolveOwnershipForCommitFile({
            repoKey,
            repoPath,
            git,
            storage,
            filePath: item.newPath,
            commitHash: commit.hash,
            warnings,
            normalizeAuthor,
            metrics,
          });

          return {
            newPath: item.newPath,
            ownership: normalizedOwnership,
          };
        }
      );

      for (const rebuilt of rebuiltOwnership) {
        if (!rebuilt || !rebuilt.ownership) {
          continue;
        }

        applyCounts(repoScores, rebuilt.ownership.counts, +1);
        activeFileStates.set(rebuilt.newPath, rebuilt.ownership);
      }
    }

    const isLastCommit = idx === totalCommits - 1;
    const persistActiveState = isLastCommit || (idx + 1) % 500 === 0;

    const checkpoint = {
      index: idx,
      commitHash: commit.hash,
      repo: repoName,
      date: commit.date,
      committer: normalizeAuthor(commit.committerRaw),
      changes: commit.changes,
      scores: cloneScores(repoScores),
      ...(persistActiveState
        ? { activeFileStates: Object.fromEntries(activeFileStates) }
        : {}),
    };

    storage.saveCheckpoint(repoKey, idx, checkpoint);

    const completedCommits = idx + 1;
    if (completedCommits % 500 === 0 || isLastCommit) {
      logRepositoryProgress(repoName, completedCommits, totalCommits, startTime);
    }
  }

  metrics.timelineProcessingMs = Date.now() - timelineStartedAtMs;

  if (warnings.length) {
    console.log(`⚠️ [${repoName}] warnings: ${warnings.length}`);
    if (debug) {
      for (const warning of warnings) {
        console.log(`   - ${warning}`);
      }
    }
  }

  logRepositoryMetrics(repoName, metrics);

  console.log(
    `✅ [${repoName}] Finished evaluation in ${formatDurationMs(Date.now() - startTime)}`
  );
  return { repoName, checkpoints: [], warnings, metrics };
}

function streamCompositeTimelineToDisk(storage, repoKeys, repoPaths, outputFile) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(outputFile, { encoding: "utf8" });

    writeStream.on("error", reject);
    writeStream.on("finish", () => resolve({ entries: totalIndex }));

    writeStream.write(
      `{\n  "generatedAt": "${new Date().toISOString()}",\n  "repositories": ${JSON.stringify(repoPaths.map((p) => path.basename(p)))},\n  "timeline": [\n`
    );

    let totalIndex = 0;
    const lastKnownRepoScores = {};

    for (const repoKey of repoKeys) {
      const dir = storage.checkpointsDir(repoKey);
      if (!fs.existsSync(dir)) continue;

      const files = fs
        .readdirSync(dir)
        .filter((fileName) => /^\d+\.json$/.test(fileName))
        .sort((a, b) => a.localeCompare(b));

      for (const file of files) {
        const checkpoint = storage.readJson(path.join(dir, file), null);
        if (!checkpoint) continue;

        const activeRepo = checkpoint.repo;
        lastKnownRepoScores[activeRepo] = cloneScores(checkpoint.scores);

        const repoScoresSnapshot = {};
        for (const repo in lastKnownRepoScores) {
          repoScoresSnapshot[repo] = cloneScores(lastKnownRepoScores[repo]);
        }

        const cleanEntry = {
          index: totalIndex,
          commitHash: checkpoint.commitHash,
          repo: checkpoint.repo,
          date: checkpoint.date,
          committer: checkpoint.committer,
          changes: checkpoint.changes,
          repoScores: repoScoresSnapshot,
        };

        if (totalIndex > 0) {
          writeStream.write(",\n");
        }

        writeStream.write(
          "    " + JSON.stringify(cleanEntry, null, 2).replace(/\n/g, "\n    ")
        );
        totalIndex += 1;
      }
    }

    writeStream.write(`\n  ]\n}`);
    writeStream.end();
  });
}

async function analyzeRepositories({
  repoPaths,
  outputFile,
  cacheDir,
  fileWorkers = 4,
  repoWorkers = 2,
  debug = false,
  authorStyle = "short",
  format = "v1",
  maxAuthors = 100,
  maxSteps = 3000,
  includeOthers = false,
  repoLabel = null,
  since = null,
  cacheKey = null,
}) {
  const startedAt = Date.now();
  const git = new LocalGitAdapter();
  const storage = new FsStorageAdapter(cacheDir);
  const repoKeyFor = (repoPath) =>
    cacheKey && repoPaths.length === 1
      ? storage.hashKey(cacheKey)
      : storage.repoKey(repoPath);
  const repoKeys = repoPaths.map(repoKeyFor);

  const safeRepoWorkers = Math.max(1, Math.floor(repoWorkers));
  const workerCount = Math.min(safeRepoWorkers, repoPaths.length);
  let nextRepoIndex = 0;

  async function repoWorker() {
    while (nextRepoIndex < repoPaths.length) {
      const currentIndex = nextRepoIndex;
      nextRepoIndex += 1;
      const repoPath = repoPaths[currentIndex];

      await analyzeSingleRepository({
        repoPath,
        git,
        storage,
        fileWorkers,
        debug,
        authorStyle,
        since,
        cacheKey: cacheKey && repoPaths.length === 1 ? cacheKey : null,
      });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => repoWorker()));

  if (format === "v2") {
    if (repoPaths.length !== 1) {
      throw new Error("--format v2 supports exactly one repository.");
    }
    console.log(`🧮 Building compact v2 export...`);
    const repoPath = repoPaths[0];
    const repoKey = repoKeys[0];
    let sha = null;
    try {
      sha = git.runGit(repoPath, ["rev-parse", "HEAD"]);
    } catch (_error) {}

    const payload = buildCompactV2({
      readCheckpoints: () => iterateCheckpointFiles(storage, repoKey),
      repoLabel: path.basename(repoPath),
      repoSlug: repoLabel || path.basename(repoPath),
      sha,
      maxAuthors,
      maxSteps,
      includeOthers,
    });
    writeCompactV2File(outputFile, payload);
    console.log(
      `📦 Compact export written to ${outputFile} (${payload.stats.steps} steps, ${payload.stats.authorsShown}/${payload.stats.authorsTotal} authors)`
    );
    return {
      outputFile,
      timelineLength: payload.stats.steps,
      stats: payload.stats,
    };
  }

  console.log(`🧮 Compiling global analytics timeline straight to disk stream...`);
  const streamStartedAtMs = Date.now();
  const streamResult = await streamCompositeTimelineToDisk(
    storage,
    repoKeys,
    repoPaths,
    outputFile
  );
  const streamDurationMs = Date.now() - streamStartedAtMs;

  console.log(
    `🧮 Composite analytics timeline stream completed in ${formatDurationMs(streamDurationMs)}`
  );
  console.log(`📦 Analysis safely written to ${outputFile}`);
  console.log(
    `🏁 Finished ${repoPaths.length} repos in ${formatDurationMs(Date.now() - startedAt)}`
  );

  return {
    outputFile,
    timelineLength: streamResult.entries,
  };
}

module.exports = {
  applyCounts,
  cloneScores,
  analyzeSingleRepository,
  analyzeRepositories,
};
