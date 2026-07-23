# Agent Instructions

## Unity version

Use Unity Version: 6000.3.0f1 installed at `C:\Program Files\Unity\Hub\Editor\6000.3.0f1\Editor\Unity.exe`.

## Validation

Always use headless Unity to open/compile the project before any other validation:

```powershell
& "C:\Program Files\Unity\Hub\Editor\6000.3.0f1\Editor\Unity.exe" -batchmode -projectPath ".\Game" -quit -logFile compile.log
```

Run EditMode tests with `-runTests -quit`. Do not run PlayMode tests in automation.

Screenshot capture requires graphics and must never use `-nographics`.

## Constraints

Do not install Unity packages without explicit approval. Build verification in CI must remain isolated and must write NUnit XML and a log file.
