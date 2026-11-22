---
name: consulting-unity-documentation
description: Use Unity's official documentation for Engine, Editor, Scripting API, Unity CLI, Pipeline, and official package questions. Match the target project's versions and prefer official Markdown.
---

# Consulting Unity Documentation

1. For a project question, read the exact copy's `ProjectSettings/ProjectVersion.txt` and, for a package, its resolved version in `Packages/packages-lock.json` or the embedded package's `package.json`. Do not assume the latest online version matches.
2. Use [Unity's official agent index](https://docs.unity.com/llms.txt) to find the relevant product, such as the [Editor](https://docs.unity.com/en-us/engine/llms.txt) or [Unity CLI](https://docs.unity.com/en-us/unity-cli/llms.txt). Fetch the relevant versioned Markdown page when available. Use the Markdown link advertised by the index or page rather than guessing a legacy URL transformation. Prefer matching official HTML to mismatched Markdown.
3. Unity CLI can resolve a page without opening a browser. Use an explicit Editor version, or run from the verified project root when the lookup needs its installed package version. Use one of `--url` (locator) or `--content` (Markdown), as needed:

   ```text
   unity --json --non-interactive docs GameObject --editor-version <editor-version> --online --url
   unity --non-interactive docs GameObject --editor-version <editor-version> --online --content
   unity --non-interactive docs --manual Coroutines --online --content
   unity --non-interactive docs --package com.unity.inputsystem --online --content
   ```

   Check the resolved version and warnings or Markdown frontmatter. Cite the actual page and version; label any fallback, and don't treat a version-line page or an unversioned search result as exact patch evidence.
4. For command syntax, installed `unity <command> --help` and the exact project's advertised Pipeline catalog and command help outrank rolling web docs. See [native targeting guidance](../unity-pipeline-workflows/references/native-cli-fleet.md).
5. For addons, assets, or packages not covered by Unity's official docs, use publisher docs or a configured, explicitly scoped `pi-unity-docs` docset if available. Use existing indexed core docs for intentional offline lookup, not as a prerequisite for ordinary Unity questions. Do not configure or build a cache unless requested.
