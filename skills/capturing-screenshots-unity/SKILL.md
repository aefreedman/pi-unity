---
name: capturing-screenshots-unity
description: Capture Unity gameplay and UI screenshots when the project workflow supports them
---
# Capturing Screenshots in Unity Skill

Purpose: capture and share visual evidence for Unity UI/gameplay changes when the workflow supports screenshots.

## When to Use

- Visual changes in Unity (UI, gameplay, effects, scenes, lighting, animations).
- Skip when there is no visual impact.
- Skip when the workflow does not support screenshots.
- For automated Unity screenshots, use a graphics-enabled workflow; `-nographics` is not valid for screenshot capture.

## Step 0: Confirm Workflow Support

1. Check `AGENTS.md` or the project-local guidance file.
2. If the local guidance does not mention screenshot support, inspect nearby project docs or review templates when available.
3. If screenshot capture is not supported, skip capture and note it in the review or delivery summary.

## Step 1: Capture

- Manual capture: ../capturing-screenshots-unity/references/manual-capture.md
- Automated capture: ../capturing-screenshots-unity/references/automated-capture.md

For automated capture in Unity batchmode:
- distinguish graphics-agnostic test runs from graphics-required screenshot runs
- do **not** use `-nographics` for screenshot or render-texture capture
- if the project tags screenshot tests with categories such as `RequiresGraphics` or `VisualCapture`, use those categories to keep screenshot tests out of graphics-disabled runs

## Step 2: What to Capture

See ../capturing-screenshots-unity/references/what-to-capture.md.

## Step 3: Upload

See ../capturing-screenshots-unity/references/upload.md.

## Step 4: Best Practices and Troubleshooting

- Best practices: ../capturing-screenshots-unity/references/best-practices.md
- Troubleshooting: ../capturing-screenshots-unity/references/troubleshooting.md

## External File Loading

CRITICAL: Use relative path references and load files only when needed for the current step.

- Do NOT preemptively load all reference files.
- Treat loaded references as mandatory instructions for the active task scope.
- Follow nested `@...` references recursively only when relevant.
- For long files, use Read with `offset`/`limit` to load only needed sections.

## Reference Files (Load On Demand)

1. Manual capture -> ../capturing-screenshots-unity/references/manual-capture.md
2. Automated capture -> ../capturing-screenshots-unity/references/automated-capture.md
3. What to capture -> ../capturing-screenshots-unity/references/what-to-capture.md
4. Upload -> ../capturing-screenshots-unity/references/upload.md
5. Best practices -> ../capturing-screenshots-unity/references/best-practices.md
6. Troubleshooting -> ../capturing-screenshots-unity/references/troubleshooting.md

## Assets

- Screenshot utility: ../capturing-screenshots-unity/assets/ScreenshotUtility.cs
