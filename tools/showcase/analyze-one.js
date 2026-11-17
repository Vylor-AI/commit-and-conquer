const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { analyzeRepositories } = require("../cc_analyze/core/analyzer");
const {
  parseRepoSlug,
  buildRepoMetadataRecord,
  assertNoEmails,
} = require("./showcaseUtils");

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    repo: "",
    outDir: "demos-out",
    cacheDir: ".cc_analyze_cache",
    workDir: "",
    ref: "",
    since: "",
    maxAuthors: 100,
    maxSteps: 3000,
    fileWorkers: Math.min(os.cpus().length, 8),
    skipGithub: false,
    noFetch: false,
    description: "",
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--repo" && args[i + 1]) {
      opts.repo = args[++i];
    } else if (token === "--out-dir" && args[i + 1]) {
      opts.outDir = args[++i];
    } else if (token === "--cache-dir" && args[i + 1]) {
      opts.cacheDir = args[++i];
    } else if (token === "--work-dir" && args[i + 1]) {
      opts.workDir = args[++i];
    } else if (token === "--ref" && args[i + 1]) {
      opts.ref = args[++i];
    } else if (token === "--since" && args[i + 1]) {
      opts.since = args[++i];
    } else if (token === "--description" && args[i + 1]) {
      opts.description = args[++i];
    } else if (token === "--max-authors" && args[i + 1]) {
      opts.maxAuthors = Number.parseInt(args[++i], 10) || opts.maxAuthors;
    } else if (token === "--max-steps" && args[i + 1]) {
      opts.maxSteps = Number.parseInt(args[++i], 10) || opts.maxSteps;
    } else if (token === "--file-workers" && args[i + 1]) {
      opts.fileWorkers = Number.parseInt(args[++i], 10) || opts.fileWorkers;
    } else if (token === "--skip-github") {
      opts.skipGithub = true;
    } else if (token === "--no-fetch") {
      opts.noFetch = true;
    }
  }

  return opts;
}

function ensureRepoClone(entry, cloneDir, ref, noFetch = false) {
  const cloneUrl = `https://github.com/${entry.owner}/${entry.name}.git`;

  if (fs.existsSync(path.join(cloneDir, ".git"))) {
    if (noFetch) {
      return;
    }
    console.log(`🔄 Updating existing clone for ${entry.slug}...`);
    execFileSync("git", ["-C", cloneDir, "fetch", "--prune", "origin"], {
      stdio: "inherit",
    });
    const targetRef = ref ? `origin/${ref}` : "origin/HEAD";
    try {
      execFileSync("git", ["-C", cloneDir, "checkout", "--force", targetRef], {
        stdio: "inherit",
      });
    } catch (_error) {
      if (ref) {
        execFileSync("git", ["-C", cloneDir, "checkout", "--force", ref], {
          stdio: "inherit",
        });
      }
    }
    return;
  }

  fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
  const args = ["clone", "--single-branch"];
  if (ref) {
    args.push("--branch", ref);
  }
  args.push(cloneUrl, cloneDir);
  console.log(`📥 Cloning ${cloneUrl}...`);
  execFileSync("git", args, { stdio: "inherit" });
}

async function fetchGithubMeta(entry) {
  if (typeof fetch !== "function") return null;

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "commit-and-conquer-showcase",
  };
  const token = (process.env.GITHUB_TOKEN || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(entry.owner)}/${encodeURIComponent(entry.name)}`,
      { headers }
    );
    if (!response.ok) {
      console.warn(
        `⚠️ GitHub API returned ${response.status} for ${entry.slug}; continuing without live metadata.`
      );
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(
      `⚠️ GitHub metadata fetch failed for ${entry.slug}: ${error.message}`
    );
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.repo) {
    throw new Error("Missing required --repo <owner/name>");
  }

  const parsed = parseRepoSlug(opts.repo);
  const entry = {
    ...parsed,
    description: opts.description || "",
  };

  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const workDir = opts.workDir
    ? path.resolve(opts.workDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), "cnc-showcase-"));
  const ownWorkDir = !opts.workDir;
  const cloneDir = path.join(workDir, entry.id);

  try {
    ensureRepoClone(entry, cloneDir, opts.ref, opts.noFetch);

    const jsonOut = path.join(outDir, `${entry.id}.json`);
    await analyzeRepositories({
      repoPaths: [cloneDir],
      outputFile: jsonOut,
      cacheDir: path.resolve(opts.cacheDir),
      fileWorkers: opts.fileWorkers,
      repoWorkers: 1,
      format: "v2",
      authorStyle: "full",
      maxAuthors: opts.maxAuthors,
      maxSteps: opts.maxSteps,
      repoLabel: entry.slug,
      since: opts.since || null,
      cacheKey: entry.slug,
    });

    assertNoEmails(jsonOut);

    const rawBytes = fs.statSync(jsonOut).size;
    const v2Payload = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
    const githubMeta = opts.skipGithub ? null : await fetchGithubMeta(entry);
    const meta = buildRepoMetadataRecord({
      entry,
      v2Payload,
      rawBytes,
      githubMeta,
    });

    fs.writeFileSync(
      path.join(outDir, `${entry.id}.meta.json`),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8"
    );

    console.log(
      `✅ Showcase ready: ${entry.slug} (${meta.commits} commits, ${meta.contributors} contributors, ${rawBytes} bytes)`
    );
  } finally {
    if (ownWorkDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("❌", error);
  process.exitCode = 1;
});
