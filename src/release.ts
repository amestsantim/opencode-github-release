import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type Bump = "patch" | "minor" | "major";
export type Result = { title: string; output: string };
export type Runner = (command: string, args: string[]) => Promise<string>;
export type Progress = (title: string) => Promise<void> | void;

export function runner(directory: string, signal?: AbortSignal): Runner {
  return async (command, args) => {
    const { stdout } = await exec(command, args, {
      cwd: directory,
      signal,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  };
}

async function optional(run: Runner, command: string, args: string[], fallback = ""): Promise<string> {
  try {
    return await run(command, args);
  } catch {
    return fallback;
  }
}

function bumpVersion(current: string, bump: Bump): string {
  const prefix = current.startsWith("v") ? "v" : "";
  const cleaned = current.replace(/^v/, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Cannot parse semver from "${current}"`);
  let major = parseInt(match[1], 10);
  let minor = parseInt(match[2], 10);
  let patch = parseInt(match[3], 10);
  if (bump === "major") { major++; minor = 0; patch = 0; }
  if (bump === "minor") { minor++; patch = 0; }
  if (bump === "patch") { patch++; }
  return `${prefix}${major}.${minor}.${patch}`;
}

function classifyCommit(subject: string, body: string): { type: "feat" | "fix" | "other"; breaking: boolean } {
  const breaking =
    /^\w+(\([^)]*\))?!:/.test(subject) ||
    /^BREAKING(?: CHANGE|-CHANGE):[ \t]+\S/m.test(body);
  const match = subject.match(/^(\w+)(\([^)]*\))?(!)?\s*:/);
  const type = match?.[1]?.toLowerCase();
  if (type === "feat") return { type: "feat", breaking };
  if (type === "fix") return { type: "fix", breaking };
  return { type: "other", breaking };
}

async function latestTag(run: Runner): Promise<string> {
  await optional(run, "git", ["fetch", "--tags", "--force"]);
  return optional(run, "git", ["describe", "--tags", "--abbrev=0"], "v0.0.0");
}

export async function suggestBump(run: Runner, progress: Progress): Promise<Result> {
  await progress("Fetching tags…");
  const tag = await latestTag(run);
  const logText = await optional(run, "git", ["log", `${tag}..HEAD`, "-z", "--format=%h%x00%s%x00%b"]);

  if (!logText) {
    return { title: "No new commits", output: `No new commits since ${tag}. No release needed.` };
  }

  const fields = logText.split("\0");
  fields.pop(); // git log -z ends each record with a NUL byte
  const entries = [];
  for (let i = 0; i < fields.length; i += 3) {
    const [hash, subject, body] = fields.slice(i, i + 3);
    entries.push({ hash, subject, ...classifyCommit(subject, body) });
  }

  let suggestedBump: Bump = "patch";
  for (const entry of entries) {
    if (entry.breaking) { suggestedBump = "major"; break; }
    if (entry.type === "feat") { suggestedBump = "minor"; }
  }

  const output = entries.map(e => {
    const tag = e.breaking ? "[BREAKING]" : e.type === "feat" ? "[feat]" : e.type === "fix" ? "[fix]" : "     ";
    return `  ${tag} ${e.hash} ${e.subject}`;
  }).join("\n");

  return {
    title: "Bump suggestion",
    output: [
      `Latest tag: ${tag}`,
      `Commits: ${entries.length}`,
      "",
      output,
      "",
      `Suggested bump: ${suggestedBump} -> ${bumpVersion(tag, suggestedBump)}`,
    ].join("\n"),
  };
}

export type ReleaseArgs = {
  bump?: Bump;
  version?: string;
  notes?: string;
  force?: boolean;
};

export async function createRelease(args: ReleaseArgs, directory: string, run: Runner, progress: Progress): Promise<Result> {
  const { bump, version, notes, force } = args;
  if (!bump && !version) {
    throw new Error("Provide either `bump` (patch/minor/major) or an explicit `version` string");
  }

  await progress("Checking working tree…");
  const status = await run("git", ["status", "--porcelain"]);
  if (status && !force) {
    const count = status.split("\n").length;
    return {
      title: "Uncommitted files",
      output: `${count} uncommitted file(s) detected. Call create_release with force: true to proceed anyway, or commit/stash first.`,
    };
  }

  await progress("Fetching tags…");
  const tag = await latestTag(run);
  const repoUsesV = tag.startsWith("v");
  const hasExistingTags = (await run("git", ["tag", "-l"])) !== "";

  let newTag: string;
  if (version) {
    const versionHasV = version.startsWith("v");
    if (hasExistingTags && versionHasV !== repoUsesV) {
      const suggestion = versionHasV ? version.replace(/^v/, "") : `v${version}`;
      return {
        title: "Version prefix mismatch",
        output: [
          `Existing releases use ${repoUsesV ? 'the "v" prefix' : 'no "v" prefix'} (e.g. "${tag}"),`,
          `but you provided "${version}" which ${versionHasV ? "has" : "does not have"} a "v" prefix.`,
          "",
          `Would you like to use "${suggestion}" instead?`,
          "If so, call create_release again with the corrected version.",
        ].join("\n"),
      };
    }
    newTag = version;
  } else {
    newTag = bumpVersion(tag, bump!);
  }

  await progress(`Bumping to ${newTag}…`);
  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

  type CommitEntry = { hash: string; subject: string };
  let unpushedBefore: CommitEntry[] = [];
  if (branch !== "HEAD") {
    const before = await optional(run, "git", ["log", `origin/${branch}..HEAD`, "--oneline"]);
    if (before) {
      unpushedBefore = before.split("\n").map(line => {
        const hash = line.split(/\s+/)[0];
        return { hash, subject: line.slice(hash.length).trim() };
      });
    }
  }

  if (existsSync(join(directory, "package.json"))) {
    const bareVersion = newTag.replace(/^v/, "");
    await run("npm", ["version", bareVersion, "--no-git-tag-version"]);
    await optional(run, "git", ["add", "package.json", "package-lock.json"]);
    await run("git", ["commit", "-m", `chore(release): bump version to ${newTag}`]);
  }

  if (branch !== "HEAD") {
    await progress("Pushing commits…");
    await run("git", ["push", "origin", branch]);
  }

  await progress("Tagging release…");
  await run("git", ["tag", "-a", newTag, "-m", notes || `Release ${newTag}`]);
  await run("git", ["push", "origin", newTag]);

  await progress("Creating GitHub release…");
  if (notes) {
    await run("gh", ["release", "create", newTag, "--title", newTag, "--notes", notes]);
  } else {
    await run("gh", ["release", "create", newTag, "--title", newTag, "--generate-notes"]);
  }

  let result = `Created and published ${newTag} (bumped from ${tag})`;
  if (branch !== "HEAD" && unpushedBefore.length > 0) {
    const remaining = await optional(run, "git", ["log", `origin/${branch}..HEAD`, "--oneline"]);
    const remainingCount = remaining ? remaining.split("\n").length : 0;
    const pushedCount = unpushedBefore.length - remainingCount;

    if (pushedCount > 0) {
      const plural = pushedCount === 1 ? "" : "s";
      result += `\nPushed ${pushedCount} commit${plural} to ${branch}:`;
      for (let i = 0; i < pushedCount; i++) {
        result += `\n  ${unpushedBefore[i].hash} ${unpushedBefore[i].subject}`;
      }
    }
    if (remainingCount > 0) {
      const plural = remainingCount === 1 ? "" : "s";
      const verb = remainingCount === 1 ? "is" : "are";
      result += `\nNote: ${remainingCount} commit${plural} in this release ${verb} not yet pushed to origin/${branch}.`;
    }
  }
  return { title: newTag, output: result };
}
