# Automated Capture

## Unity CLI (Graphics-enabled isolated run)

```bash
unity run "<ProjectPath>" -- \
  -executeMethod ScreenshotUtility.CaptureGameView \
  -quit
```

Do not forward `-nographics`; screenshot capture requires an active graphics device. When using `unity_launch_batchmode`, set `useGraphics: true`.

## Utility Script

Use the helper script at:

- ../../capturing-screenshots-unity/assets/ScreenshotUtility.cs

Place it in `Assets/Editor/` and recompile. Screenshots are saved to
`Screenshots/` at the project root.
