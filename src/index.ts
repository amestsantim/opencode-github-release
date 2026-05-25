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

const plugin: Plugin = async ({ $ }) => {
  return {
    tool: {
      create_release: tool({
        description:
          "Create a git tag and publish a GitHub release with semantic versioning. "
          + "Provide either `bump` to auto-compute the next version from the latest tag, "
          + "or an explicit `version` string (e.g. \"2.0.0\" or \"v2.0.0\").",
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

          return `✓ Created and published ${newTag} (bumped from ${latestTag})`;
        },
      }),
    },
  };
};

export default plugin;
