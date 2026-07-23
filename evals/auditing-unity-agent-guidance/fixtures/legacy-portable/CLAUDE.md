# Unity Workflow

The project is in `UnityProject`.

Compile with `unity -batchmode -projectPath UnityProject -quit -logFile -`.

Run tests using the direct Editor executable with `-batchmode -runTests -testPlatform EditMode -testResults Results.xml -logFile test.log`. CI must remain an isolated clean run and publish `Results.xml`.

If compilation fails, delete `Temp/UnityLockfile` and retry.
