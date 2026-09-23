using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

// Two builds of this file ship in the bundle:
// - nowplaying.exe  (console): the CLI - `--help`, `--version`, `setup --browser`, update scripts.
// - nowplayingw.exe (Windows GUI, NOWPLAYING_GUI): what shortcuts and the installer launch.
//   It never opens a console window; if the app fails to start it shows the
//   app's own error text in a message box instead of a console nobody sees.
internal static class NowPlayingLauncher
{
#if NOWPLAYING_GUI
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
#endif

    public static int Main(string[] args)
    {
        string root = AppContext.BaseDirectory;
        string runtime = Path.Combine(root, "runtime", "node.exe");
        string entry = Path.Combine(root, "app", "scripts", "windows-entry.js");

        if (!File.Exists(runtime) || !File.Exists(entry))
        {
            Fail("nowplaying: portable bundle is incomplete; re-extract the full ZIP.");
            return 2;
        }

        var start = new ProcessStartInfo
        {
            FileName = runtime,
            UseShellExecute = false,
            WorkingDirectory = root
        };
#if NOWPLAYING_GUI
        // node.exe is a console program; without this Windows gives it a console window.
        start.CreateNoWindow = true;
        start.RedirectStandardError = true;
        start.RedirectStandardOutput = true;
#endif
        start.ArgumentList.Add(entry);
        foreach (string argument in args) start.ArgumentList.Add(argument);

        using Process process = Process.Start(start) ?? throw new InvalidOperationException("Unable to start bundled runtime.");
#if NOWPLAYING_GUI
        var errors = new System.Text.StringBuilder();
        process.ErrorDataReceived += (_, e) => { if (e.Data != null && errors.Length < 4000) errors.AppendLine(e.Data); };
        process.OutputDataReceived += (_, _) => { };
        process.BeginErrorReadLine();
        process.BeginOutputReadLine();
#endif
        process.WaitForExit();
#if NOWPLAYING_GUI
        string message = errors.ToString().Trim();
        if (process.ExitCode != 0 && message.Length > 0) Fail(message.Length > 800 ? message.Substring(message.Length - 800) : message);
#endif
        return process.ExitCode;
    }

    private static void Fail(string message)
    {
#if NOWPLAYING_GUI
        MessageBoxW(IntPtr.Zero, message, "NowPlaying", 0x10);
#else
        Console.Error.WriteLine(message);
#endif
    }
}
