# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning for public package releases.

## [0.2.0] - 2026-06-16

### Added

- Added Unity CLI integration so `unity_open_editor` prefers `unity open` and `unity_launch_batchmode` prefers `unity run` when the installed `unity` command is available.
- Added Unity CLI status parsing for safer same-project busy checks before launching GUI or batchmode Unity.
- Added `UNITY_CLI_PATH` support for overriding the Unity CLI executable.
- Added `launcher` selection (`auto`, `unity-cli`, `editor-executable`) so workflows can bypass Unity CLI when forwarded arguments differ from direct Editor executable behavior.
- Added Unity CLI argument normalization that strips direct-Editor flags managed by `unity run` (`-batchmode`, `-projectPath`, `-quit`) before forwarding user args.
- Added unit coverage for Unity CLI command construction, forwarded-argument normalization, and status parsing.

### Changed

- Kept direct Unity Editor executable launch as a fallback when Unity CLI is unavailable or cannot resolve the environment.
- Updated Unity batchmode skill and README guidance to document the Unity CLI preferred path and fallback behavior.

## [0.1.0] - 2026-04-27

### Added

- Initial Pi Unity package with Unity Editor GUI launch, batchmode execution, Unity Test Framework summary parsing, project discovery, single-project process safeguards, and screenshot workflow guidance.
