using System;
using System.Diagnostics;
using System.IO;

internal static class NowPlayingLauncher
{
    public static int Main(string[] args)
    {
        string root = AppContext.BaseDirectory;
        string runtime = Path.Combine(root, "runtime", "node.exe");
        string entry = Path.Combine(root, "app", "scripts", "windows-entry.js");

        if (!File.Exists(runtime) || !File.Exists(entry))
        {
            Console.Error.WriteLine("nowplaying: portable bundle is incomplete; re-extract the full ZIP.");
            return 2;
        }

        var start = new ProcessStartInfo
        {
            FileName = runtime,
            UseShellExecute = false,
            WorkingDirectory = root
        };
        start.ArgumentList.Add(entry);
        foreach (string argument in args) start.ArgumentList.Add(argument);

        using Process process = Process.Start(start) ?? throw new InvalidOperationException("Unable to start bundled runtime.");
        process.WaitForExit();
        return process.ExitCode;
    }
}
