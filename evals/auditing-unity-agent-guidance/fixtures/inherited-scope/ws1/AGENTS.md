# ws1 agent guidance

## Unity automation

- Unity Version: 6000.3.0f1
- Build with `Unity.exe -batchmode -projectPath Game -executeMethod BuildScript.Build`.
- Raw Editor `-runTests` commands must not include `-quit`.
- EditMode tests use the `Example.Tests` namespace and write results under `Game/Logs/`.
