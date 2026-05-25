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

Ask OpenCode to create a release. The plugin provides a `create_release` tool with these modes:

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
