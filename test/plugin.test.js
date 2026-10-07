import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import plugin from "../dist/index.js";
import { createRelease, suggestBump } from "../dist/release.js";

const execFile = promisify(execFileCallback);

function fakeRunner(responses) {
  const calls = [];
  const run = async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    return responses[key] ?? "";
  };
  return { run, calls };
}

test("V1 and V2 expose the same named tools", async () => {
  assert.equal(plugin.id, "opencode-github-release");
  const v1 = await plugin.server({});
  const tools = [];
  await plugin.setup({
    tool: { transform: async callback => callback({ add: definition => tools.push(definition) }) },
    session: { get: async () => ({ location: { directory: "/unused" } }) },
  });
  assert.deepEqual(Object.keys(v1.tool).sort(), tools.map(t => t.name).sort());
  assert.equal(tools.find(t => t.name === "create_release").input.properties.bump.enum[2], "major");
});

test("suggestion classifies conventional commits without publishing", async () => {
  const { run, calls } = fakeRunner({
    "git describe --tags --abbrev=0": "v1.2.3",
    "git log v1.2.3..HEAD -z --format=%h%x00%s%x00%b": "aaa\0feat: a feature\0\0bbb\0fix: a fix\0\0",
  });
  const result = await suggestBump(run, () => {});
  assert.match(result.output, /Suggested bump: minor -> v1\.3\.0/);
  assert.equal(calls.some(call => call.includes("push") || call.startsWith("gh ")), false);
});

test("suggestion recognizes both breaking footer spellings and exclamation marks", async () => {
  const log = "aaa\0fix(api): change response\0Explain the change.\n\nBREAKING CHANGE: clients must adapt\n\0"
    + "bbb\0refactor: change config\0BREAKING-CHANGE: old keys no longer work\n\0"
    + "ccc\0feat(core)!: remove legacy API\0\0";
  const { run } = fakeRunner({
    "git describe --tags --abbrev=0": "v1.2.3",
    "git log v1.2.3..HEAD -z --format=%h%x00%s%x00%b": log,
  });
  const result = await suggestBump(run, () => {});
  assert.match(result.output, /Commits: 3/);
  assert.match(result.output, /\[BREAKING\] aaa fix\(api\): change response/);
  assert.match(result.output, /\[BREAKING\] bbb refactor: change config/);
  assert.match(result.output, /\[BREAKING\] ccc feat\(core\)!: remove legacy API/);
  assert.match(result.output, /Suggested bump: major -> v2\.0\.0/);
});

test("dirty tree and prefix mismatch stop before publishing", async () => {
  const dirty = fakeRunner({ "git status --porcelain": " M src/index.ts" });
  const warning = await createRelease({ bump: "patch" }, "/unused", dirty.run, () => {});
  assert.equal(warning.title, "Uncommitted files");
  assert.deepEqual(dirty.calls, ["git status --porcelain"]);

  const mismatch = fakeRunner({
    "git describe --tags --abbrev=0": "v1.2.3",
    "git tag -l": "v1.2.3",
  });
  const result = await createRelease({ version: "2.0.0" }, "/unused", mismatch.run, () => {});
  assert.equal(result.title, "Version prefix mismatch");
  assert.equal(mismatch.calls.some(call => call.includes("push") || call.startsWith("gh ")), false);
});

test("release passes notes as one argument and pushes before publishing", async () => {
  const { run, calls } = fakeRunner({
    "git describe --tags --abbrev=0": "v1.2.3",
    "git tag -l": "v1.2.3",
    "git rev-parse --abbrev-ref HEAD": "main",
  });
  const notes = "Fixed issue with 'quotes' and spaces";
  const result = await createRelease({ bump: "patch", notes }, "/unused", run, () => {});
  assert.equal(result.title, "v1.2.4");
  assert.ok(calls.indexOf("git push origin v1.2.4") < calls.indexOf(`gh release create v1.2.4 --title v1.2.4 --notes ${notes}`));
});

test("both entrypoints analyze the tool session's repository", async t => {
  const directory = await mkdtemp("/tmp/opencode/github-release-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = async (...args) => execFile("git", args, { cwd: directory });
  await git("init", "--quiet");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial", "--quiet");
  await git("tag", "v1.0.0");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "feat: new feature", "--quiet");

  const v1 = await plugin.server({});
  const old = await v1.tool.suggest_bump.execute({}, {
    directory,
    abort: new AbortController().signal,
    metadata() {},
  });
  assert.match(old.output, /Suggested bump: minor -> v1\.1\.0/);

  const tools = [];
  await plugin.setup({
    tool: { transform: async callback => callback({ add: definition => tools.push(definition) }) },
    session: { get: async () => ({ location: { directory } }) },
  });
  const current = await tools.find(t => t.name === "suggest_bump").execute({}, {
    sessionID: "test-session",
    signal: new AbortController().signal,
    progress: async () => {},
  });
  assert.match(current.content, /Suggested bump: minor -> v1\.1\.0/);

  await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "fix: update API", "-m", "Details.\n\nBREAKING CHANGE: old clients must migrate", "--quiet");
  const breaking = await tools.find(t => t.name === "suggest_bump").execute({}, {
    sessionID: "test-session",
    signal: new AbortController().signal,
    progress: async () => {},
  });
  assert.match(breaking.content, /Suggested bump: major -> v2\.0\.0/);
});
