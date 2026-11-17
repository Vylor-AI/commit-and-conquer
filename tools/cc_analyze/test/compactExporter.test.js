const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { analyzeRepositories } = require("../core/analyzer");
const { buildCompactV2 } = require("../core/compactExporter");
const { buildAuthorNormalizer } = require("../identity/authorIdentity");

// The browser decoder is an IIFE that attaches to `window`.
global.window = {};
require(path.join(
  __dirname,
  "..",
  "..",
  "..",
  "public",
  "scripts",
  "history-normalizer.js"
));
const { normalizeImportedHistory } = global.window.HistoryNormalizer;

function cp(i, committer, scores, added = 10, removed = 2) {
  return {
    index: i,
    date: new Date(Date.UTC(2024, 0, 1 + i, 12, 0, 0)).toISOString(),
    committer,
    changes: { added, removed },
    scores,
  };
}

function build(checkpoints, opts = {}) {
  return buildCompactV2({
    readCheckpoints: () => checkpoints[Symbol.iterator](),
    repoLabel: "demo",
    repoSlug: "acme/demo",
    ...opts,
  });
}

function dropZeros(scores) {
  return Object.fromEntries(
    Object.entries(scores).filter(([, loc]) => loc > 0)
  );
}

function total(scores) {
  return Object.values(scores).reduce((a, b) => a + b, 0);
}

test("v2 round trip reproduces every step's scores", () => {
  const checkpoints = [
    cp(0, "Ann", { Ann: 100 }),
    cp(1, "Bob", { Ann: 100, Bob: 40 }),
    cp(2, "Ann", { Ann: 130, Bob: 40 }),
    cp(3, "Bob", { Ann: 90, Bob: 80 }),
    cp(4, "Cy", { Ann: 90, Bob: 0, Cy: 60 }),
  ];

  const payload = build(checkpoints, { maxAuthors: 10, maxSteps: 100 });
  const { history, errors } = normalizeImportedHistory(
    JSON.parse(JSON.stringify(payload))
  );

  assert.equal(errors.length, 0);
  assert.equal(history.length, checkpoints.length);
  history.forEach((step, i) => {
    assert.equal(step.committer, checkpoints[i].committer);
    assert.equal(step.repo, "demo");
    assert.deepEqual(step.changes, { added: 10, removed: 2 });
    assert.deepEqual(
      dropZeros(step.repoScores.demo),
      dropZeros(checkpoints[i].scores)
    );
  });
});

test("authors beyond maxAuthors are excluded cleanly when includeOthers is false (default)", () => {
  const scores = { A: 500, B: 400, C: 300, D: 20, E: 10 };
  const checkpoints = [
    cp(0, "A", { A: 500 }),
    cp(1, "D", { A: 500, D: 20 }),
    cp(2, "E", { ...scores }),
  ];

  const payload = build(checkpoints, { maxAuthors: 2, maxSteps: 100 });
  assert.deepEqual(
    payload.authors.map((a) => a.n),
    ["A", "B"]
  );
  assert.equal(payload.stats.authorsTotal, 5);
  assert.equal(payload.steps[1][1], -1);

  const { history } = normalizeImportedHistory(payload);
  assert.equal(history[1].committer, "");
  assert.deepEqual(history[history.length - 1].repoScores.demo, {
    A: 500,
    B: 400,
  });
});

test("authors beyond the cap fold into Others when includeOthers is true", () => {
  const scores = { A: 500, B: 400, C: 300, D: 20, E: 10 };
  const checkpoints = [
    cp(0, "A", { A: 500 }),
    cp(1, "D", { A: 500, D: 20 }),
    cp(2, "E", { ...scores }),
  ];

  const payload = build(checkpoints, {
    maxAuthors: 3,
    maxSteps: 100,
    includeOthers: true,
  });
  // 3 slots: top 2 authors (A, B) + "Others"
  assert.deepEqual(
    payload.authors.map((a) => a.n),
    ["A", "B", "Others"]
  );
  assert.equal(payload.stats.authorsTotal, 5);

  const { history } = normalizeImportedHistory(payload);
  const last = history[history.length - 1].repoScores.demo;
  assert.deepEqual(last, { A: 500, B: 400, Others: 300 + 20 + 10 });
  assert.equal(total(last), total(scores));
});

test("step cap buckets commits but keeps the final state", () => {
  const checkpoints = [];
  let loc = 0;
  for (let i = 0; i < 25; i += 1) {
    loc += 10;
    checkpoints.push(cp(i, i % 2 ? "Bob" : "Ann", { Ann: loc, Bob: 5 }));
  }

  const payload = build(checkpoints, { maxAuthors: 10, maxSteps: 5 });
  assert.ok(payload.steps.length <= 5);
  // added/removed are summed across each bucket
  const totalAdded = payload.steps.reduce((acc, s) => acc + s[2], 0);
  assert.equal(totalAdded, 25 * 10);

  const { history } = normalizeImportedHistory(payload);
  assert.deepEqual(
    history[history.length - 1].repoScores.demo,
    { Ann: 250, Bob: 5 }
  );
  // chronological
  for (let i = 1; i < history.length; i += 1) {
    assert.ok(new Date(history[i].date) >= new Date(history[i - 1].date));
  }
});

test("full-name normalizer drops emails and unifies blame/committer forms", () => {
  const { normalize } = buildAuthorNormalizer([], { style: "full" });
  assert.equal(normalize("Jane Doe <jane@example.com>"), "Jane Doe");
  assert.equal(normalize("Jane Doe"), "Jane Doe");
  assert.equal(normalize("  Jane   Doe  "), "Jane Doe");
  assert.equal(normalize(""), "Unknown");
});

test("full-name normalizer unifies case variants to the most common spelling", () => {
  const { normalize } = buildAuthorNormalizer(
    [
      "TJ Holowaychuk <tj@example.com>",
      "TJ Holowaychuk <tj@example.com>",
      "Tj Holowaychuk <tj@example.com>",
    ],
    { style: "full" }
  );
  assert.equal(normalize("Tj Holowaychuk <tj@example.com>"), "TJ Holowaychuk");
  assert.equal(normalize("Tj Holowaychuk"), "TJ Holowaychuk");
  assert.equal(normalize("TJ Holowaychuk"), "TJ Holowaychuk");
});

test("published v2 output never contains an email address", () => {
  const { normalize } = buildAuthorNormalizer([], { style: "full" });
  const raw = [
    cp(0, normalize("Ann Lee <ann@example.com>"), { "Ann Lee": 10 }),
    cp(1, normalize("Bo Ray <bo@example.com>"), {
      "Ann Lee": 10,
      "Bo Ray": 5,
    }),
  ];
  const json = JSON.stringify(build(raw));
  assert.equal(json.includes("@"), false);
});

function gitCommit(repoDir, { name, email, date, message }) {
  execFileSync("git", ["-C", repoDir, "add", "-A"]);
  execFileSync("git", ["-C", repoDir, "commit", "-m", message], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: date,
    },
  });
}

test("v1 and v2 produce identical decoded scores on a real git repo and honor --since", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cnc-git-eq-"));
  const repoDir = path.join(tmp, "sample-repo");
  fs.mkdirSync(repoDir, { recursive: true });

  try {
    execFileSync("git", ["init", repoDir]);
    execFileSync("git", ["-C", repoDir, "config", "user.name", "Init User"]);
    execFileSync("git", ["-C", repoDir, "config", "user.email", "init@example.com"]);

    fs.writeFileSync(path.join(repoDir, "app.js"), "a\nb\nc\n");
    gitCommit(repoDir, {
      name: "Alice Dev",
      email: "alice@example.com",
      date: "2024-01-10T10:00:00Z",
      message: "init app",
    });

    fs.writeFileSync(path.join(repoDir, "app.js"), "a\nb\nx\ny\n");
    fs.writeFileSync(path.join(repoDir, "util.js"), "u1\nu2\n");
    gitCommit(repoDir, {
      name: "Bob Coder",
      email: "bob@example.com",
      date: "2024-03-15T10:00:00Z",
      message: "update app and add util",
    });

    fs.renameSync(path.join(repoDir, "util.js"), path.join(repoDir, "helper.js"));
    gitCommit(repoDir, {
      name: "alice dev",
      email: "alice@example.com",
      date: "2024-06-01T10:00:00Z",
      message: "rename util",
    });

    const v1Out = path.join(tmp, "out.v1.json");
    const v2Out = path.join(tmp, "out.v2.json");

    await analyzeRepositories({
      repoPaths: [repoDir],
      outputFile: v1Out,
      cacheDir: path.join(tmp, "cache-v1"),
      fileWorkers: 2,
      repoWorkers: 1,
      format: "v1",
      authorStyle: "full",
    });

    await analyzeRepositories({
      repoPaths: [repoDir],
      outputFile: v2Out,
      cacheDir: path.join(tmp, "cache-v2"),
      fileWorkers: 2,
      repoWorkers: 1,
      format: "v2",
      authorStyle: "full",
      repoLabel: "org/sample-repo",
      cacheKey: "org/sample-repo",
    });

    const v2Raw = fs.readFileSync(v2Out, "utf8");
    assert.equal(v2Raw.includes("@"), false);

    const v1Decoded = normalizeImportedHistory(
      JSON.parse(fs.readFileSync(v1Out, "utf8"))
    ).history;
    const v2Decoded = normalizeImportedHistory(JSON.parse(v2Raw)).history;

    assert.equal(v1Decoded.length, 3);
    assert.equal(v2Decoded.length, 3);
    v1Decoded.forEach((step1, idx) => {
      const step2 = v2Decoded[idx];
      assert.equal(step2.committer, step1.committer);
      assert.deepEqual(
        dropZeros(step2.repoScores["sample-repo"]),
        dropZeros(step1.repoScores["sample-repo"])
      );
    });

    // Verify --since filters earlier commits while accurately blaming initial state
    const sinceOut = path.join(tmp, "out.since.v2.json");
    await analyzeRepositories({
      repoPaths: [repoDir],
      outputFile: sinceOut,
      cacheDir: path.join(tmp, "cache-since"),
      fileWorkers: 2,
      repoWorkers: 1,
      format: "v2",
      authorStyle: "full",
      repoLabel: "org/sample-repo",
      since: "2024-03-01",
    });

    const sinceDecoded = normalizeImportedHistory(
      JSON.parse(fs.readFileSync(sinceOut, "utf8"))
    ).history;
    assert.equal(sinceDecoded.length, 2);
    assert.deepEqual(
      dropZeros(sinceDecoded[sinceDecoded.length - 1].repoScores["sample-repo"]),
      dropZeros(v2Decoded[v2Decoded.length - 1].repoScores["sample-repo"])
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
