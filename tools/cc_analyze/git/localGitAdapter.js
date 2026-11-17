const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const COMMIT_MARKER = "__CC_COMMIT__";
const DEFAULT_MAX_BUFFER = 1024 * 1024 * 512;

class LocalGitAdapter {
  constructor() {
    this.gitBackend = (process.env.CC_ANALYZE_GIT_BACKEND || "cli").trim().toLowerCase();
    this._nodeGit = undefined;
    this._didWarnNodeGit = false;
  }

  runGit(repoPath, args, options = {}) {
    const result = spawnSync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: options.maxBuffer || DEFAULT_MAX_BUFFER,
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      const cmd = `git ${args.join(" ")}`;
      throw new Error(stderr || `Command failed (${result.status}): ${cmd}`);
    }

    return (result.stdout || "").trim();
  }

  // Stream git stdout line-by-line so large histories never hit maxBuffer limits.
  spawnGitLines(repoPath, args, onLine) {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: repoPath,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stderrChunks = [];
      child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      rl.on("line", onLine);

      let settled = false;
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        rl.close();
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
          const cmd = `git ${args.join(" ")}`;
          reject(new Error(stderr || `Command failed (${code}): ${cmd}`));
          return;
        }
        resolve();
      });
    });
  }

  isGitRepo(repoPath) {
    return fs.existsSync(path.join(repoPath, ".git"));
  }

  findGitReposOneLevel(basePath) {
    const repos = [];
    if (this.isGitRepo(basePath)) {
      repos.push(basePath);
    }

    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(basePath, entry.name);
      if (this.isGitRepo(candidate)) {
        repos.push(candidate);
      }
    }

    return repos;
  }

  normalizeNumstatPath(rawPath) {
    if (!rawPath) return rawPath;
    if (rawPath.startsWith('"') && rawPath.endsWith('"')) {
      return rawPath.slice(1, -1);
    }
    return rawPath;
  }

  getRichCommits(repoPath, isAnalyzableFile) {
    const output = this.runGit(repoPath, [
      "log",
      "--reverse",
      "--date=iso-strict",
      `--pretty=format:${COMMIT_MARKER}%x1f%H%x1f%cI%x1f%aN <%aE>`,
      "--numstat",
      "--",
    ]);

    if (!output) {
      return [];
    }

    const lines = output.split("\n");
    const commits = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      if (current.analyzableFiles > 0) {
        commits.push({
          hash: current.hash,
          date: current.date,
          committerRaw: current.committerRaw,
          changes: current.changes,
        });
      }
    };

    for (const line of lines) {
      if (!line) continue;

      if (line.startsWith(`${COMMIT_MARKER}\x1f`)) {
        flush();
        const parts = line.split("\x1f");
        current = {
          hash: parts[1],
          date: parts[2],
          committerRaw: parts[3],
          changes: { added: 0, removed: 0 },
          analyzableFiles: 0,
        };
        continue;
      }

      if (!current) {
        continue;
      }

      const parts = line.split("\t");
      if (parts.length < 3) {
        continue;
      }

      const additionsRaw = parts[0];
      const deletionsRaw = parts[1];
      const filePath = this.normalizeNumstatPath(parts.slice(2).join("\t"));

      if (!isAnalyzableFile(filePath)) {
        continue;
      }

      const additions = Number.parseInt(additionsRaw, 10);
      const deletions = Number.parseInt(deletionsRaw, 10);

      current.analyzableFiles += 1;
      current.changes.added += Number.isFinite(additions) ? additions : 0;
      current.changes.removed += Number.isFinite(deletions) ? deletions : 0;
    }

    flush();
    return commits;
  }

  async getRichCommitsAsync(repoPath, isAnalyzableFile, options = {}) {
    const args = [
      "log",
      "--reverse",
      "--date=iso-strict",
      `--pretty=format:${COMMIT_MARKER}%x1f%H%x1f%cI%x1f%aN <%aE>`,
      "--numstat",
    ];
    if (options && typeof options.since === "string" && options.since.trim()) {
      args.push(`--since=${options.since.trim()}`);
    }
    args.push("--");

    const commits = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      if (current.analyzableFiles > 0) {
        commits.push({
          hash: current.hash,
          date: current.date,
          committerRaw: current.committerRaw,
          changes: current.changes,
        });
      }
    };

    await this.spawnGitLines(repoPath, args, (line) => {
      if (!line) return;

      if (line.startsWith(`${COMMIT_MARKER}\x1f`)) {
        flush();
        const parts = line.split("\x1f");
        current = {
          hash: parts[1],
          date: parts[2],
          committerRaw: parts[3],
          changes: { added: 0, removed: 0 },
          analyzableFiles: 0,
        };
        return;
      }

      if (!current) return;

      const parts = line.split("\t");
      if (parts.length < 3) return;

      const filePath = this.normalizeNumstatPath(parts.slice(2).join("\t"));
      if (!isAnalyzableFile(filePath)) return;

      const additions = Number.parseInt(parts[0], 10);
      const deletions = Number.parseInt(parts[1], 10);
      current.analyzableFiles += 1;
      current.changes.added += Number.isFinite(additions) ? additions : 0;
      current.changes.removed += Number.isFinite(deletions) ? deletions : 0;
    });

    flush();
    return commits;
  }

  getCommitHistoryChangesMap(repoPath) {
    const output = this.runGit(repoPath, [
      "log",
      "--reverse",
      "--name-status",
      "--pretty=format:COMMIT:%H",
      "--",
    ]);

    const map = new Map();
    if (!output) {
      return map;
    }

    const lines = output.split("\n");
    let currentHash = null;

    for (const line of lines) {
      if (!line) continue;

      if (line.startsWith("COMMIT:")) {
        currentHash = line.slice("COMMIT:".length).trim();
        map.set(currentHash, []);
        continue;
      }

      if (!currentHash) continue;
      const parsed = this.parseNameStatusDiff(line);
      if (parsed) {
        map.get(currentHash).push(parsed);
      }
    }

    return map;
  }

  async getCommitHistoryChangesMapAsync(repoPath) {
    const map = new Map();
    let currentHash = null;

    await this.spawnGitLines(
      repoPath,
      ["log", "--reverse", "--name-status", "--pretty=format:COMMIT:%H", "--"],
      (line) => {
        if (!line) return;
        if (line.startsWith("COMMIT:")) {
          currentHash = line.slice("COMMIT:".length).trim();
          map.set(currentHash, []);
          return;
        }
        if (!currentHash) return;
        const parsed = this.parseNameStatusDiff(line);
        if (parsed) {
          map.get(currentHash).push(parsed);
        }
      }
    );

    return map;
  }

  getAllAuthors(repoPath) {
    const output = this.runGit(repoPath, ["log", "--format=%aN <%aE>"]);
    if (!output) return [];
    const unique = new Set();
    const authors = [];
    for (const line of output.split("\n")) {
      const value = line.trim();
      if (!value || unique.has(value)) continue;
      unique.add(value);
      authors.push(value);
    }
    return authors;
  }

  listFilesAtCommit(repoPath, commitHash) {
    const output = this.runGit(repoPath, ["ls-tree", "-r", "--name-only", commitHash]);
    if (!output) return [];
    return output.split("\n").map((v) => v.trim()).filter(Boolean);
  }

  parseNameStatusDiff(line) {
    const parts = line.split("\t");
    if (parts.length < 2) return null;

    const statusRaw = parts[0];
    const kind = statusRaw[0];

    if (kind === "R" || kind === "C") {
      if (parts.length < 3) return null;
      return {
        type: kind,
        oldPath: parts[1],
        newPath: parts[2],
      };
    }

    return {
      type: kind,
      path: parts[1],
    };
  }

  getChangedFiles(repoPath, commitHash) {
    const output = this.runGit(repoPath, ["diff-tree", "--no-commit-id", "--name-status", "-r", commitHash]);
    if (!output) return [];
    return output
      .split("\n")
      .map((line) => this.parseNameStatusDiff(line))
      .filter(Boolean);
  }

  pathExistsAtCommit(repoPath, commitHash, filePath) {
    try {
      this.runGit(repoPath, ["cat-file", "-e", `${commitHash}:${filePath}`]);
      return true;
    } catch (_error) {
      return false;
    }
  }

  loadNodeGit() {
    if (this._nodeGit !== undefined) {
      return this._nodeGit;
    }

    try {
      this._nodeGit = require("nodegit");
      return this._nodeGit;
    } catch (_error) {
      this._nodeGit = null;
      if (!this._didWarnNodeGit) {
        this._didWarnNodeGit = true;
        console.warn(
          "⚠️ [cc_analyze] NodeGit backend requested but package 'nodegit' is not installed. Falling back to CLI git blame."
        );
      }
      return null;
    }
  }

  async blameFileAtCommit(repoPath, commitHash, filePath) {
    if (this.gitBackend === "nodegit") {
      const nodeGitOwnership = await this.blameFileAtCommitWithNodeGit(repoPath, commitHash, filePath);
      if (nodeGitOwnership) {
        return nodeGitOwnership;
      }
    }

    return this.blameFileAtCommitWithCliAsync(repoPath, commitHash, filePath);
  }

  blameFileAtCommitWithCliAsync(repoPath, commitHash, filePath) {
    return new Promise((resolve) => {
      const counts = {};
      let sawLine = false;
      let remainder = "";

      const child = spawn(
        "git",
        ["blame", commitHash, "--line-porcelain", "--", filePath],
        { cwd: repoPath, stdio: ["ignore", "pipe", "ignore"] }
      );

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        const text = remainder + chunk;
        const lines = text.split("\n");
        remainder = lines.pop() || "";

        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          if (line.startsWith("author ")) {
            const clean = line.endsWith("\r") ? line.slice(7, -1) : line.slice(7);
            const key = clean.trim() || "Unknown";
            counts[key] = (counts[key] || 0) + 1;
            sawLine = true;
          }
        }
      });

      child.on("error", () => resolve(null));
      child.on("close", (code) => {
        if (remainder.startsWith("author ")) {
          const clean = remainder.endsWith("\r")
            ? remainder.slice(7, -1)
            : remainder.slice(7);
          const key = clean.trim() || "Unknown";
          counts[key] = (counts[key] || 0) + 1;
          sawLine = true;
        }
        if (code !== 0 || !sawLine) {
          resolve(null);
          return;
        }
        const totalLines = Object.values(counts).reduce((acc, value) => acc + value, 0);
        resolve({ counts, totalLines });
      });
    });
  }

  async blameFileAtCommitWithNodeGit(repoPath, commitHash, filePath) {
    const NodeGit = this.loadNodeGit();
    if (!NodeGit) {
      return null;
    }

    try {
      const repo = await NodeGit.Repository.open(repoPath);
      const newestCommit = NodeGit.Oid.fromString(commitHash);
      const blame = await NodeGit.Blame.file(repo, filePath, { newestCommit });

      const counts = {};
      const hunkCount = blame.getHunkCount();

      for (let idx = 0; idx < hunkCount; idx += 1) {
        const hunk = blame.getHunkByIndex(idx);
        const finalCommitId = hunk.finalCommitId();
        const lineCount = hunk.linesInHunk();

        let author = "Unknown <unknown>";
        if (finalCommitId) {
          const commit = await NodeGit.Commit.lookup(repo, finalCommitId);
          const signature = commit.author();
          if (signature) {
            const name = signature.name() || "Unknown";
            const email = signature.email() || "unknown";
            author = `${name} <${email}>`;
          }
        }

        counts[author] = (counts[author] || 0) + lineCount;
      }

      const totalLines = Object.values(counts).reduce((acc, value) => acc + value, 0);
      return { counts, totalLines };
    } catch (_error) {
      return null;
    }
  }

  blameFileAtCommitWithCli(repoPath, commitHash, filePath) {
    if (!this.pathExistsAtCommit(repoPath, commitHash, filePath)) {
      return null;
    }

    let output;
    try {
      output = this.runGit(repoPath, ["blame", commitHash, "--line-porcelain", "--", filePath], {
        maxBuffer: 1024 * 1024 * 200,
      });
    } catch (_error) {
      return null;
    }

    if (!output) {
      return null;
    }

    const counts = {};
    for (const line of output.split("\n")) {
      if (!line.startsWith("author ")) continue;
      const authorName = line.slice("author ".length).trim();
      const key = authorName || "Unknown";
      counts[key] = (counts[key] || 0) + 1;
    }

    const totalLines = Object.values(counts).reduce((acc, value) => acc + value, 0);
    return { counts, totalLines };
  }
}

module.exports = {
  LocalGitAdapter,
};
