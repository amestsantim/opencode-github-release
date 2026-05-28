# opencode-github-release

An [OpenCode](https://opencode.ai) plugin that creates git tags and publishes GitHub releases with semantic versioning.

[![npm](https://badgen.net/npm/v/opencode-github-release)](https://www.npmjs.com/package/opencode-github-release)
[![GitHub](https://badgen.net/github/stars/amestsantim/opencode-github-release)](https://github.com/amestsantim/opencode-github-release)
[![License: MIT](https://badgen.net/github/license/amestsantim/opencode-github-release)](https://opensource.org/licenses/MIT)

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-github-release"]
}
```

Restart OpenCode. The plugin loads automatically.

## Usage

Ask OpenCode to create a release. The plugin provides `create_release` and `suggest_bump` tools. When you give a specific version or bump, `create_release` is called directly. When you don't, `suggest_bump` analyzes your commits first and asks for confirmation. Modes:

**Auto-bump from latest tag:**
```
Create a patch release
Create a minor release
Create a major release
```

**Explicit version:**
```
Release version 2.0.0
```

**With release notes:**
```
Create a patch release with notes "Fixed login bug"
```

**Auto-suggest from git history:**
```
Create a release
```

**Suggest a bump (without releasing):**
```
What version should I use?
```

**Override dirty tree check:**
```
Create a major release with force: true
```

## How it works

When you request a release, the plugin fetches the latest git tag from the repository and computes the next version from it. If you specify a bump (`patch`/`minor`/`major`) or an explicit version, it creates the tag and release immediately. If you don't specify either (e.g., just "create a release"), the plugin instead runs `suggest_bump` — it analyzes commits since the latest tag using conventional commit conventions: `fix` → patch, `feat` → minor, `BREAKING CHANGE` → major — and presents the suggestion for your confirmation before proceeding.

If you don't provide release notes, the plugin automatically generates them from the commit history via `gh release create --generate-notes`.

`create_release` checks for uncommitted changes before proceeding. If the working tree is dirty, it returns a warning and asks you to commit, stash, or pass `force: true`.

It expects conventional commit messages (`feat:`, `fix:`, `BREAKING CHANGE:`) for accurate auto-suggestion. Commits that follow this convention are classified as:

- `fix:` → patch bump
- `feat:` → minor bump
- `BREAKING CHANGE:` or `feat!:` / `fix!:` → major bump

Example output when running `suggest_bump`:

```
Latest tag: v0.1.0
Commits: 3

  [fix] a1b2c3d Fix login timeout
  [feat] e4f5g6h Add user dashboard
  [BREAKING] i7j8k9l Redesign auth API

Suggested bump: major -> v1.0.0
```

You can invoke `suggest_bump` directly at any time ("Suggest a bump") — it analyzes commits since the latest tag and recommends a bump without creating anything.

The `suggest_bump` tool works exceptionally well if your commit messages follow the [conventional commits specification](https://www.conventionalcommits.org/en/v1.0.0/). 

There are commit skills such as (https://github.com/PedroHBO/opencode-config-skills/tree/main/skills/git-commit) that makes it all automatic and seamless.

## Prerequisites

- [Git](https://git-scm.com/)
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated to your account
- The current directory must be a git repository with a remote named `origin`

## Development

```bash
npm install
npm run typecheck
npm run build
npm pack --dry-run
```

## License

MIT
