import { Plugin } from "@opencode/plugin";
import { tool, type Plugin as V1Plugin } from "@opencode-ai/plugin";
import { createRelease, runner, suggestBump, type ReleaseArgs, type Result } from "./release.js";

const suggestDescription =
  "Analyze git history since the latest tag and suggest a semantic version bump. "
  + "Call this tool when the user asks to create a release but does NOT specify "
  + "patch/minor/major or an explicit version string. "
  + "After receiving the suggestion, present it to the user and ask for confirmation "
  + "before calling create_release.";

const releaseDescription =
  "Create a git tag and publish a GitHub release with semantic versioning. "
  + "Provide either `bump` to auto-compute the next version from the latest tag, "
  + "or an explicit `version` string (e.g. \"2.0.0\" or \"v2.0.0\"). "
  + "If the user only asks to \"create a release\" without specifying a bump or version, "
  + "call suggest_bump first instead of this tool.";

const v1: V1Plugin = async () => ({
  tool: {
    suggest_bump: tool({
      description: suggestDescription,
      args: {},
      async execute(_args, context) {
        return suggestBump(runner(context.directory, context.abort), title => context.metadata({ title }));
      },
    }),
    create_release: tool({
      description: releaseDescription,
      args: {
        bump: tool.schema.enum(["patch", "minor", "major"]).optional(),
        version: tool.schema.string().optional(),
        notes: tool.schema.string().optional(),
        force: tool.schema.boolean().optional(),
      },
      async execute(args, context) {
        return createRelease(args, context.directory, runner(context.directory, context.abort), title => context.metadata({ title }));
      },
    }),
  },
});

// V1 (1.18.29+) uses server(); V2 uses id/setup(). Both register the same tools.
export default {
  ...Plugin.define({
    id: "opencode-github-release",
    async setup(ctx) {
      await ctx.tool.transform(editor => {
        editor.add({
          name: "suggest_bump",
          description: suggestDescription,
          input: { type: "object", properties: {}, additionalProperties: false },
          async execute(_input, context) {
            const session = await ctx.session.get({ sessionID: context.sessionID });
            const result = await suggestBump(
              runner(session.location.directory, context.signal),
              title => context.progress({ status: title }),
            );
            return { content: result.output, metadata: { title: result.title } };
          },
        });

        editor.add({
          name: "create_release",
          description: releaseDescription,
          input: {
            type: "object",
            properties: {
              bump: { type: "string", enum: ["patch", "minor", "major"] },
              version: { type: "string" },
              notes: { type: "string" },
              force: { type: "boolean" },
            },
            additionalProperties: false,
          },
          async execute(input, context) {
            const session = await ctx.session.get({ sessionID: context.sessionID });
            const result: Result = await createRelease(
              input as ReleaseArgs,
              session.location.directory,
              runner(session.location.directory, context.signal),
              title => context.progress({ status: title }),
            );
            return { content: result.output, metadata: { title: result.title } };
          },
        });
      });
    },
  }),
  server: v1,
};
