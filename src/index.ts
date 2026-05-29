import { type Plugin, tool } from "@opencode-ai/plugin";

function bumpVersion(current: string, bump: "patch" | "minor" | "major"): string {
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

function classifyCommit(subject: string): { type: "feat" | "fix" | "other"; breaking: boolean } {
  const breaking =
    /^BREAKING CHANGE:/im.test(subject) ||
    /^\w+(\([^)]*\))?!:/m.test(subject);
  const match = subject.match(/^(\w+)(\([^)]*\))?(!)?\s*:/);
  const type = match?.[1]?.toLowerCase();
  if (type === "feat") return { type: "feat", breaking };
  if (type === "fix") return { type: "fix", breaking };
  return { type: "other", breaking };
}

const plugin: Plugin = async ({ $ }) => {
  return {
    tool: {
      suggest_bump: tool({
        description:
          "Analyze git history since the latest tag and suggest a semantic version bump. "
          + "Call this tool when the user asks to create a release but does NOT specify "
          + "patch/minor/major or an explicit version string. "
          + "After receiving the suggestion, present it to the user and ask for confirmation "
          + "before calling create_release.",
        args: {},
        async execute(_args, context) {
          context.metadata({ title: "Fetching tags…" });
          await $`git fetch --tags --force 2>/dev/null || true`.quiet();

          const tagResult = await $`git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"`.text();
          const latestTag = tagResult.trim();

          const logText = await $`git log ${latestTag}..HEAD --oneline 2>/dev/null || true`.text();

          if (!logText) {
            return {
              title: "No new commits",
              output: `No new commits since ${latestTag}. No release needed.`,
            };
          }

          const lines = logText.split("\n");
          const entries = lines.map(line => {
            const hash = line.split(/\s+/)[0];
            const subject = line.slice(hash.length).trim();
            const { type, breaking } = classifyCommit(subject);
            return { hash, subject, type, breaking };
          });

          let suggestedBump: "patch" | "minor" | "major" = "patch";
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
              `Latest tag: ${latestTag}`,
              `Commits: ${entries.length}`,
              "",
              output,
              "",
              `Suggested bump: ${suggestedBump} -> ${bumpVersion(latestTag, suggestedBump)}`,
            ].join("\n"),
          };
        },
      }),

      create_release: tool({
        description:
          "Create a git tag and publish a GitHub release with semantic versioning. "
          + "Provide either \`bump\` to auto-compute the next version from the latest tag, "
          + "or an explicit \`version\` string (e.g. \"2.0.0\" or \"v2.0.0\"). "
          + "If the user only asks to \"create a release\" without specifying a bump or version, "
          + "call suggest_bump first instead of this tool.",
        args: {
          bump: tool.schema.enum(["patch", "minor", "major"]).optional(),
          version: tool.schema.string().optional(),
          notes: tool.schema.string().optional(),
          force: tool.schema.boolean().optional(),
        },
        async execute(args, context) {
          const { bump, version, notes, force } = args as {
            bump?: "patch" | "minor" | "major";
            version?: string;
            notes?: string;
            force?: boolean;
          };

          if (!bump && !version) {
            throw new Error("Provide either `bump` (patch/minor/major) or an explicit `version` string");
          }

          context.metadata({ title: "Checking working tree…" });
          const status = (await $`git status --porcelain`.text()).trim();
          if (status && !force) {
            const count = status.split("\n").length;
            return {
              title: "Uncommitted files",
              output: `${count} uncommitted file(s) detected. Call create_release with force: true to proceed anyway, or commit/stash first.`,
            };
          }

          context.metadata({ title: "Fetching tags…" });
          await $`git fetch --tags --force 2>/dev/null || true`.quiet();

          const tagResult = await $`git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"`.text();
          const latestTag = tagResult.trim();

          const repoUsesV = latestTag.startsWith("v");
          const hasExistingTags = parseInt((await $`git tag -l 2>/dev/null | wc -l`.text()).trim(), 10) > 0;

          let newTag: string;
          if (version) {
            const versionHasV = version.startsWith("v");
            if (hasExistingTags && versionHasV !== repoUsesV) {
              const suggestion = versionHasV
                ? version.replace(/^v/, "")
                : `v${version}`;
              return {
                title: "Version prefix mismatch",
                output: [
                  `Existing releases use ${repoUsesV ? 'the "v" prefix' : 'no "v" prefix'} (e.g. "${latestTag}"),`,
                  `but you provided "${version}" which ${versionHasV ? "has" : "does not have"} a "v" prefix.`,
                  "",
                  `Would you like to use "${suggestion}" instead?`,
                  "If so, call create_release again with the corrected version.",
                ].join("\n"),
              };
            }
            newTag = version;
          } else {
            newTag = bumpVersion(latestTag, bump!);
          }

          context.metadata({ title: `Bumping to ${newTag}…` });
          const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();

          type CommitEntry = { hash: string; subject: string };
          let unpushedBefore: CommitEntry[] = [];
          if (branch !== "HEAD") {
            const before = (await $`git log origin/${branch}..HEAD --oneline 2>/dev/null || true`.text()).trim();
            if (before) {
              unpushedBefore = before.split("\n").map(line => {
                const hash = line.split(/\s+/)[0];
                return { hash, subject: line.slice(hash.length).trim() };
              });
            }
          }

          const hasPkg = (await $`test -f package.json && echo "yes" || echo "no"`.text()).trim() === "yes";
          if (hasPkg) {
            const bareVersion = newTag.replace(/^v/, "");
            await $`npm version ${bareVersion} --no-git-tag-version`.quiet();
            await $`git add package.json package-lock.json 2>/dev/null || true`.quiet();
            await $`git commit -m ${`chore(release): bump version to ${newTag}`}`.quiet();
          }

          if (branch !== "HEAD") {
            context.metadata({ title: "Pushing commits…" });
            await $`git push origin ${branch}`.quiet();
          }

          context.metadata({ title: "Tagging release…" });
          const message = notes || `Release ${newTag}`;
          await $`git tag -a ${newTag} -m ${message}`.quiet();
          await $`git push origin ${newTag}`.quiet();

          context.metadata({ title: "Creating GitHub release…" });
          if (notes) {
            await $`gh release create ${newTag} --title ${newTag} --notes ${notes}`.quiet();
          } else {
            await $`gh release create ${newTag} --title ${newTag} --generate-notes`.quiet();
          }

          let result = `Created and published ${newTag} (bumped from ${latestTag})`;
          if (branch !== "HEAD" && unpushedBefore.length > 0) {
            const remaining = (await $`git log origin/${branch}..HEAD --oneline 2>/dev/null || true`.text()).trim();
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
        },
      }),
    },
  };
};

export default plugin;
