# Automated Capture

## Unity CLI (Batch Mode)

```bash
unity -batchmode \
  -projectPath . \
  -executeMethod ScreenshotUtility.CaptureGameView \
  -quit
```

## Utility Script

Use the helper script at:

- ../../capturing-screenshots-unity/assets/ScreenshotUtility.cs

Place it in `Assets/Editor/` and recompile. Screenshots are saved to
`Screenshots/` at the project root.
