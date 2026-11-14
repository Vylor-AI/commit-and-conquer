const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class FsStorageAdapter {
  constructor(baseDir = ".cc_data", options = {}) {
    if (baseDir && typeof baseDir === "object") {
      options = baseDir;
      baseDir = options.baseDir || ".cc_data";
    }

    this.baseDir = path.resolve(baseDir);
    this.options = options || {};

    const envMode = process.env.CC_ANALYZE_OWNERSHIP_CACHE_MODE;
    this.ownershipCacheMode =
      this.options.ownershipCacheMode || envMode || "memory";
    this.ownershipMemoryOnly = this.ownershipCacheMode !== "disk";

    this.inMemoryOwnership = new Map();
    this.inMemoryPathIndex = new Map();

    this.ensureDir(this.baseDir);
  }

  ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  repoKey(repoPath) {
    return this.hashKey(path.resolve(repoPath));
  }

  hashKey(value) {
    return crypto.createHash("sha1").update(String(value)).digest("hex");
  }

  repoRoot(repoKey) {
    return path.join(this.baseDir, repoKey);
  }

  ownershipDir(repoKey) {
    return path.join(this.repoRoot(repoKey), "ownership");
  }

  checkpointsDir(repoKey) {
    return path.join(this.repoRoot(repoKey), "checkpoints");
  }

  metaFile(repoKey) {
    return path.join(this.repoRoot(repoKey), "meta.json");
  }

  pathIndexFile(repoKey) {
    return path.join(this.repoRoot(repoKey), "path_index.json");
  }

  resetRepo(repoKey) {
    fs.rmSync(this.repoRoot(repoKey), { recursive: true, force: true });

    for (const key of Array.from(this.inMemoryOwnership.keys())) {
      if (key.startsWith(`${repoKey}\n`)) {
        this.inMemoryOwnership.delete(key);
      }
    }

    this.inMemoryPathIndex.delete(repoKey);
  }

  ensureRepo(repoKey) {
    this.ensureDir(this.repoRoot(repoKey));
    this.ensureDir(this.checkpointsDir(repoKey));
    this.ensureDir(this.ownershipDir(repoKey));

    if (!this.ownershipMemoryOnly && !fs.existsSync(this.pathIndexFile(repoKey))) {
      this.writeJson(this.pathIndexFile(repoKey), {});
    }
  }

  readJson(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) {
      return fallback;
    }

    try {
      return JSON.parse(raw);
    } catch (_error) {
      return fallback;
    }
  }

  writeJson(filePath, data) {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  loadPathIndex(repoKey) {
    if (this.ownershipMemoryOnly) {
      return this.inMemoryPathIndex.get(repoKey) || {};
    }

    return this.readJson(this.pathIndexFile(repoKey), {}) || {};
  }

  savePathIndex(repoKey, pathIndex) {
    if (this.ownershipMemoryOnly) {
      this.inMemoryPathIndex.set(repoKey, pathIndex || {});
      return;
    }

    this.writeJson(this.pathIndexFile(repoKey), pathIndex || {});
  }

  ownershipMemoryKey(repoKey, filePath, commitHash) {
    return `${repoKey}\n${commitHash || ""}\n${filePath}`;
  }

  parseOwnershipMemoryKey(key) {
    const first = key.indexOf("\n");
    const second = key.indexOf("\n", first + 1);

    if (first < 0 || second < 0) {
      return null;
    }

    return {
      repoKey: key.slice(0, first),
      commitHash: key.slice(first + 1, second),
      filePath: key.slice(second + 1),
    };
  }

  ownershipFilePath(repoKey, filePath, commitHash = "") {
    const cacheKey = `${commitHash}::${filePath}`;
    const index = this.loadPathIndex(repoKey);
    let token = index[cacheKey];

    if (!token) {
      token = this.hashKey(cacheKey);
      index[cacheKey] = token;
      this.savePathIndex(repoKey, index);
    }

    return path.join(this.ownershipDir(repoKey), `${token}.json`);
  }

  saveFileOwnership(repoKey, filePath, ownership, commitHash = "") {
    if (!ownership) return;

    if (this.ownershipMemoryOnly) {
      const memKey = this.ownershipMemoryKey(repoKey, filePath, commitHash);
      this.inMemoryOwnership.set(memKey, ownership);
      return;
    }

    const file = this.ownershipFilePath(repoKey, filePath, commitHash);
    this.writeJson(file, ownership);
  }

  loadFileOwnership(repoKey, filePath, commitHash = "") {
    if (this.ownershipMemoryOnly) {
      const memKey = this.ownershipMemoryKey(repoKey, filePath, commitHash);
      return this.inMemoryOwnership.get(memKey) || null;
    }

    const file = this.ownershipFilePath(repoKey, filePath, commitHash);
    return this.readJson(file, null);
  }

  deleteFileOwnership(repoKey, filePath, commitHash = "") {
    if (this.ownershipMemoryOnly) {
      if (commitHash) {
        const memKey = this.ownershipMemoryKey(repoKey, filePath, commitHash);
        this.inMemoryOwnership.delete(memKey);
        return;
      }

      for (const key of Array.from(this.inMemoryOwnership.keys())) {
        const parsed = this.parseOwnershipMemoryKey(key);
        if (!parsed) continue;
        if (parsed.repoKey === repoKey && parsed.filePath === filePath) {
          this.inMemoryOwnership.delete(key);
        }
      }
      return;
    }

    if (commitHash) {
      const file = this.ownershipFilePath(repoKey, filePath, commitHash);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      return;
    }

    const index = this.loadPathIndex(repoKey);
    let changed = false;

    for (const [cacheKey, token] of Object.entries(index)) {
      if (!cacheKey.endsWith(`::${filePath}`)) continue;
      const file = path.join(this.ownershipDir(repoKey), `${token}.json`);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      delete index[cacheKey];
      changed = true;
    }

    if (changed) {
      this.savePathIndex(repoKey, index);
    }
  }

  moveFileOwnership(repoKey, fromPath, toPath) {
    if (fromPath === toPath) return;

    if (this.ownershipMemoryOnly) {
      const updates = [];
      for (const [key, ownership] of this.inMemoryOwnership.entries()) {
        const parsed = this.parseOwnershipMemoryKey(key);
        if (!parsed) continue;
        if (parsed.repoKey !== repoKey || parsed.filePath !== fromPath) continue;

        const nextKey = this.ownershipMemoryKey(
          repoKey,
          toPath,
          parsed.commitHash
        );
        updates.push({ oldKey: key, nextKey, ownership });
      }

      for (const update of updates) {
        this.inMemoryOwnership.delete(update.oldKey);
        this.inMemoryOwnership.set(update.nextKey, update.ownership);
      }
      return;
    }

    const index = this.loadPathIndex(repoKey);
    let changed = false;

    for (const [cacheKey, token] of Object.entries(index)) {
      if (!cacheKey.endsWith(`::${fromPath}`)) continue;

      const sep = cacheKey.indexOf("::");
      const commitHash = sep >= 0 ? cacheKey.slice(0, sep) : "";
      const nextCacheKey = `${commitHash}::${toPath}`;

      if (index[nextCacheKey]) {
        const srcFile = path.join(this.ownershipDir(repoKey), `${token}.json`);
        if (fs.existsSync(srcFile)) fs.rmSync(srcFile, { force: true });
      } else {
        index[nextCacheKey] = token;
      }

      delete index[cacheKey];
      changed = true;
    }

    if (changed) {
      this.savePathIndex(repoKey, index);
    }
  }

  saveCheckpoint(repoKey, index, checkpoint) {
    const fileName = `${String(index).padStart(8, "0")}.json`;
    const filePath = path.join(this.checkpointsDir(repoKey), fileName);
    this.writeJson(filePath, checkpoint);
  }

  loadLatestCheckpoint(repoKey) {
    const dir = this.checkpointsDir(repoKey);
    if (!fs.existsSync(dir)) return null;

    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();

    if (!files.length) return null;

    const latestFile = path.join(dir, files[files.length - 1]);
    return this.readJson(latestFile, null);
  }

  loadAllCheckpoints(repoKey) {
    const dir = this.checkpointsDir(repoKey);
    if (!fs.existsSync(dir)) return [];

    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();

    const checkpoints = [];
    for (const fileName of files) {
      const checkpoint = this.readJson(path.join(dir, fileName), null);
      if (checkpoint) checkpoints.push(checkpoint);
    }
    return checkpoints;
  }

  saveMeta(repoKey, meta) {
    this.writeJson(this.metaFile(repoKey), meta || {});
  }
}

module.exports = {
  FsStorageAdapter,
};
