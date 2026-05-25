import { type Plugin, tool } from "@opencode-ai/plugin";

function bumpVersion(current: string, bump: "patch" | "minor" | "major"): string {
  const cleaned = current.replace(/^v/, "");
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Cannot parse semver from "${current}"`);
  let major = parseInt(match[1], 10);
  let minor = parseInt(match[2], 10);
  let patch = parseInt(match[3], 10);
  if (bump === "major") { major++; minor = 0; patch = 0; }
  if (bump === "minor") { minor++; patch = 0; }
  if (bump === "patch") { patch++; }
  return `v${major}.${minor}.${patch}`;
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
        async execute(_args, _context) {
          await $`git fetch --tags --force 2>/dev/null || true`;

          const tagResult = await $`git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"`;
          const latestTag = tagResult.stdout.toString().trim();

          const logResult = await $`git log ${latestTag}..HEAD --oneline 2>/dev/null || true`;
          const logText = logResult.stdout.toString().trim();

          if (!logText) {
            return `No new commits since ${latestTag}. No release needed.`;
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

          return [
            `Latest tag: ${latestTag}`,
            `Commits: ${entries.length}`,
            "",
            output,
            "",
            `Suggested bump: ${suggestedBump} -> ${bumpVersion(latestTag, suggestedBump)}`,
          ].join("\n");
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
        },
        async execute(args, _context) {
          const { bump, version, notes } = args as {
            bump?: "patch" | "minor" | "major";
            version?: string;
            notes?: string;
          };

          if (!bump && !version) {
            throw new Error("Provide either `bump` (patch/minor/major) or an explicit `version` string");
          }

          await $`git fetch --tags --force 2>/dev/null || true`;

          const result = await $`git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"`;
          const latestTag = result.stdout.toString().trim();

          const newTag = version
            ? (version.startsWith("v") ? version : `v${version}`)
            : bumpVersion(latestTag, bump!);

          const message = notes || `Release ${newTag}`;
          await $`git tag -a ${newTag} -m ${message}`;
          await $`git push origin ${newTag}`;

          if (notes) {
            await $`gh release create ${newTag} --title ${newTag} --notes ${notes}`;
          } else {
            await $`gh release create ${newTag} --title ${newTag} --generate-notes`;
          }

          return `Created and published ${newTag} (bumped from ${latestTag})`;
        },
      }),
    },
  };
};

export default plugin;
