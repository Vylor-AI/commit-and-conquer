#!/usr/bin/env node

const os = require("os");
const path = require("path");
const { analyzeRepositories } = require("./core/analyzer");
const { LocalGitAdapter } = require("./git/localGitAdapter");

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "0s";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const repoArgs = [];
  let outputFile = "commit_and_conquer_data.json";
  let cacheDir = ".cc_analyze_cache";
  let fileWorkers = Math.min(os.cpus().length, 8);
  let repoWorkers = 2;
  let debug = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === "--debug" || token === "-d") {
      debug = true;
      continue;
    }

    if (token === "--output" && args[i + 1]) {
      outputFile = args[i + 1];
      i += 1;
      continue;
    }

    if (token === "--cache-dir" && args[i + 1]) {
      cacheDir = args[i + 1];
      i += 1;
      continue;
    }

    if (token === "--file-workers" && args[i + 1]) {
      fileWorkers = parsePositiveInt(args[i + 1], fileWorkers);
      i += 1;
      continue;
    }

    if (token === "--repo-workers" && args[i + 1]) {
      repoWorkers = parsePositiveInt(args[i + 1], repoWorkers);
      i += 1;
      continue;
    }

    repoArgs.push(token);
  }

  return { repoArgs, outputFile, cacheDir, fileWorkers, repoWorkers, debug };
}

function resolveRepoPaths(repoArgs, git) {
  const cwd = process.cwd();

  if (repoArgs.length > 0) {
    return repoArgs.map((repoPath) => path.resolve(cwd, repoPath));
  }

  if (git.isGitRepo(cwd)) {
    return [cwd];
  }

  const childRepos = git.findGitReposOneLevel(cwd);
  if (childRepos.length > 0) {
    return childRepos;
  }

  throw new Error(
    "No git repositories found.\n" +
      "Usage: cc_analyze <repo1> <repo2> ...\n" +
      "Or run from inside a git repo.\n" +
      "Or run from a folder containing git repos (one level deep)."
  );
}

async function main() {
  const startedAt = Date.now();

  try {
    const { repoArgs, outputFile, cacheDir, fileWorkers, repoWorkers, debug } =
      parseArgs(process.argv);

    const git = new LocalGitAdapter();
    const repoPaths = resolveRepoPaths(repoArgs, git);

    const analyzeResult = await analyzeRepositories({
      repoPaths,
      outputFile,
      cacheDir,
      fileWorkers,
      repoWorkers,
      debug,
    });

    console.log(`✅ Finished! Output stored in ${analyzeResult.outputFile}`);
    console.log(`📈 Timeline entries: ${analyzeResult.timelineLength}`);
    console.log(`⏱️ Total time: ${formatDurationMs(Date.now() - startedAt)}`);
  } catch (error) {
    console.error("❌", error);
    console.log(`⏱️ Failed after: ${formatDurationMs(Date.now() - startedAt)}`);
    process.exitCode = 1;
  }
}

main();
