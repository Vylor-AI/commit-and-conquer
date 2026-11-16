const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  parseRepoSlug,
  loadShowcaseConfig,
  buildRepoMetadataRecord,
  assertNoEmails,
  assembleShowcaseIndex,
} = require("../showcaseUtils");

test("parseRepoSlug accepts owner/name and rejects unsafe paths", () => {
  assert.deepEqual(parseRepoSlug("sindresorhus/chalk"), {
    owner: "sindresorhus",
    name: "chalk",
    slug: "sindresorhus/chalk",
    id: "sindresorhus-chalk",
  });
  assert.deepEqual(parseRepoSlug("tj/commander.js").id, "tj-commander.js");
  assert.throws(() => parseRepoSlug("../etc/passwd"));
  assert.throws(() => parseRepoSlug("onlyone"));
  assert.throws(() => parseRepoSlug("a/b/c"));
});

test("loadShowcaseConfig loads curated list and filters single repo", () => {
  const configPath = path.join(__dirname, "..", "..", "..", "showcase", "repos.json");
  const all = loadShowcaseConfig(configPath);
  assert.ok(all.length >= 3);
  assert.equal(all[0].slug, "sindresorhus/chalk");
  assert.equal(all[0].maxAuthors, 100);

  const one = loadShowcaseConfig(configPath, "expressjs/express");
  assert.equal(one.length, 1);
  assert.equal(one[0].id, "expressjs-express");
});

test("buildRepoMetadataRecord builds manifest entry from v2 payload", () => {
  const entry = parseRepoSlug("sindresorhus/chalk");
  const v2Payload = {
    v: 2,
    repo: "sindresorhus/chalk",
    sha: "deadbeef",
    stats: { commits: 352, steps: 352, authorsTotal: 67, authorsShown: 25 },
    authors: [{ n: "Sindre Sorhus" }],
    steps: [
      [1375489138, 0, 285, 0, [[0, 285]]],
      [1792704278, 0, 10, 0, [[0, 295]]],
    ],
  };

  const record = buildRepoMetadataRecord({
    entry: { ...entry, description: "" },
    v2Payload,
    rawBytes: 14387,
    githubMeta: {
      description: "Terminal string styling done right",
      stargazers_count: 22000,
      language: "JavaScript",
      owner: { avatar_url: "https://avatars.githubusercontent.com/u/170270" },
    },
  });

  assert.equal(record.id, "sindresorhus-chalk");
  assert.equal(record.stars, 22000);
  assert.equal(record.commits, 352);
  assert.equal(record.contributors, 67);
  assert.equal(record.firstCommit, "2013-08-03");
  assert.equal(record.lastCommit, "2026-10-22");
  assert.equal(record.file, "sindresorhus-chalk.json");
  assert.equal(record.rawBytes, 14387);
});

test("assembleShowcaseIndex preserves prior entries when a job fails", () => {
  const c1 = parseRepoSlug("org/one");
  const c2 = parseRepoSlug("org/two");
  const c3 = parseRepoSlug("org/removed");

  const index = assembleShowcaseIndex({
    configEntries: [c1, c2],
    repoMetasById: {
      "org-one": {
        id: "org-one",
        file: "org-one.json",
        description: "",
        stars: null,
        language: null,
      },
    },
    previousIndex: {
      repos: [
        {
          id: "org-one",
          file: "org-one.json",
          description: "Prev desc",
          stars: 99,
          language: "JS",
        },
        {
          id: "org-two",
          file: "org-two.json",
          description: "Two",
          stars: 50,
        },
        {
          id: c3.id,
          file: "org-removed.json",
          description: "Gone",
        },
      ],
    },
    fileExists: (f) => f === "org-one.json" || f === "org-two.json",
  });

  assert.equal(index.repos.length, 2);
  assert.equal(index.repos[0].stars, 99);
  assert.equal(index.repos[0].description, "Prev desc");
  assert.equal(index.repos[1].id, "org-two");
});

test("assertNoEmails rejects artifacts containing @", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cnc-priv-"));
  const bad = path.join(tmp, "bad.json");
  const good = path.join(tmp, "good.json");
  try {
    fs.writeFileSync(bad, '{"n":"user@example.com"}');
    fs.writeFileSync(good, '{"n":"Jane Doe"}');
    assert.throws(() => assertNoEmails(bad));
    assert.doesNotThrow(() => assertNoEmails(good));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("build-index CLI assembles valid demos directory and merges previous", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cnc-idx-"));
  try {
    const config = path.join(tmp, "repos.json");
    const artifacts = path.join(tmp, "artifacts");
    const prev = path.join(tmp, "prev");
    const out = path.join(tmp, "out");
    fs.mkdirSync(path.join(artifacts, "a"), { recursive: true });
    fs.mkdirSync(prev, { recursive: true });

    fs.writeFileSync(config, JSON.stringify([{ repo: "a/one" }, { repo: "b/two" }]));
    fs.writeFileSync(path.join(artifacts, "a", "a-one.json"), '{"v":2,"steps":[]}');
    fs.writeFileSync(
      path.join(artifacts, "a", "a-one.meta.json"),
      JSON.stringify({ id: "a-one", owner: "a", name: "one", file: "a-one.json" })
    );
    fs.writeFileSync(path.join(prev, "b-two.json"), '{"v":2,"steps":[]}');
    fs.writeFileSync(
      path.join(prev, "index.json"),
      JSON.stringify({
        repos: [{ id: "b-two", owner: "b", name: "two", file: "b-two.json" }],
      })
    );

    execFileSync("node", [
      path.join(__dirname, "..", "build-index.js"),
      "--config",
      config,
      "--artifacts-dir",
      artifacts,
      "--previous-dir",
      prev,
      "--out-dir",
      out,
    ]);

    const built = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
    assert.equal(built.repos.length, 2);
    assert.ok(fs.existsSync(path.join(out, "a-one.json")));
    assert.ok(fs.existsSync(path.join(out, "b-two.json")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
