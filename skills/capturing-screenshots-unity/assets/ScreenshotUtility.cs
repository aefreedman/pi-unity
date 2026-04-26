#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

public static class ScreenshotUtility
{
    [MenuItem("Tools/Capture Screenshot")]
    public static void CaptureGameView()
    {
        string timestamp = System.DateTime.Now.ToString("yyyyMMdd_HHmmss");
        string filename = $"Screenshot_{timestamp}.png";
        string path = System.IO.Path.Combine(Application.dataPath, "..", "Screenshots", filename);

        string directory = System.IO.Path.GetDirectoryName(path);
        if (!System.IO.Directory.Exists(directory))
        {
            System.IO.Directory.CreateDirectory(directory);
        }

        ScreenCapture.CaptureScreenshot(path);
        Debug.Log($"Screenshot saved: {path}");
    }

    [MenuItem("Tools/Capture Screenshot (2x Resolution)")]
    public static void CaptureGameViewHighRes()
    {
        string timestamp = System.DateTime.Now.ToString("yyyyMMdd_HHmmss");
        string filename = $"Screenshot_2x_{timestamp}.png";
        string path = System.IO.Path.Combine(Application.dataPath, "..", "Screenshots", filename);

        string directory = System.IO.Path.GetDirectoryName(path);
        if (!System.IO.Directory.Exists(directory))
        {
            System.IO.Directory.CreateDirectory(directory);
        }

        ScreenCapture.CaptureScreenshot(path, 2);
        Debug.Log($"High-res screenshot saved: {path}");
    }
}
#endif
