const fs = require("fs");
const path = require("path");
const {
  loadShowcaseConfig,
  assertNoEmails,
  assembleShowcaseIndex,
} = require("./showcaseUtils");

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    config: path.join("showcase", "repos.json"),
    artifactsDir: "",
    outDir: "demos",
    previousDir: "",
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--config" && args[i + 1]) {
      opts.config = args[++i];
    } else if (token === "--artifacts-dir" && args[i + 1]) {
      opts.artifactsDir = args[++i];
    } else if (token === "--out-dir" && args[i + 1]) {
      opts.outDir = args[++i];
    } else if (token === "--previous-dir" && args[i + 1]) {
      opts.previousDir = args[++i];
    }
  }

  return opts;
}

function collectFilesRecursive(dir, results = []) {
  if (!dir || !fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  const opts = parseArgs(process.argv);
  const configEntries = loadShowcaseConfig(path.resolve(opts.config));
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const repoMetasById = {};
  const jsonSourceByFile = new Map();

  for (const filePath of collectFilesRecursive(
    path.resolve(opts.artifactsDir)
  )) {
    const base = path.basename(filePath);
    if (base.endsWith(".meta.json")) {
      const meta = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (meta && meta.id) repoMetasById[meta.id] = meta;
    } else if (base.endsWith(".json") && base !== "index.json") {
      jsonSourceByFile.set(base, filePath);
    }
  }

  let previousIndex = null;
  const prevDir = opts.previousDir ? path.resolve(opts.previousDir) : "";
  if (prevDir && fs.existsSync(path.join(prevDir, "index.json"))) {
    try {
      previousIndex = JSON.parse(
        fs.readFileSync(path.join(prevDir, "index.json"), "utf8")
      );
    } catch (_error) {}
  }

  for (const entry of configEntries) {
    const meta = repoMetasById[entry.id];
    const fileName = (meta && meta.file) || `${entry.id}.json`;
    const freshJson = jsonSourceByFile.get(fileName);
    const prevJson = prevDir ? path.join(prevDir, fileName) : "";

    const source = freshJson || (prevJson && fs.existsSync(prevJson) ? prevJson : "");
    if (!source) continue;

    assertNoEmails(source);
    fs.copyFileSync(source, path.join(outDir, fileName));
  }

  const index = assembleShowcaseIndex({
    configEntries,
    repoMetasById,
    previousIndex,
    fileExists: (fileName) => fs.existsSync(path.join(outDir, fileName)),
  });

  if (index.repos.length === 0) {
    throw new Error("No showcase repositories succeeded; aborting publish.");
  }

  fs.writeFileSync(
    path.join(outDir, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `📦 Built showcase index with ${index.repos.length}/${configEntries.length} repositories in ${outDir}`
  );
}

main();
