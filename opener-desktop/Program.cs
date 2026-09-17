namespace Hunterstar.Opener;

static class Program
{
    /// <summary>
    ///  The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main()
    {
        // To customize application configuration such as set high DPI settings or default font,
        // see https://aka.ms/applicationconfiguration.
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, @"Local\Hunterstar.Opener.Desktop", out var first);
        var smokeTest = Environment.GetCommandLineArgs().Contains("--smoke-test");
        if (!first && !smokeTest)
        {
            foreach (var process in System.Diagnostics.Process.GetProcessesByName("AccountCenter"))
                if (process.Id != Environment.ProcessId && process.MainWindowHandle != IntPtr.Zero)
                {
                    ShowWindow(process.MainWindowHandle, 9);
                    SetForegroundWindow(process.MainWindowHandle);
                }
            return;
        }
        Application.Run(new OpenerWindow(smokeTest));
    }    
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr handle);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr handle, int command);
}
