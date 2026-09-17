using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Text.Json;

namespace Hunterstar.Opener;

internal sealed class OpenerWindow : Form
{
    private const string LocalOrigin = "https://opener.local";
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(10, 10, 12) };
    private readonly OpenerService service = new();
    private readonly bool smokeTest;
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    internal OpenerWindow(bool smokeTest)
    {
        this.smokeTest = smokeTest;
        Text = "Hunterstar Account Center";
        ClientSize = new Size(1440, 940);
        MinimumSize = new Size(440, 600);
        StartPosition = FormStartPosition.CenterScreen;
        var webFolder = FindWebFolder();
        var icon = Path.Combine(webFolder, "favicon.ico");
        if (File.Exists(icon)) Icon = new Icon(icon);
        Controls.Add(browser);
        Shown += async (_, _) => await InitializeAsync();
    }

    private static string FindWebFolder()
    {
        var inBase = Path.Combine(AppContext.BaseDirectory, "Web");
        if (Directory.Exists(inBase)) return Path.GetFullPath(inBase);
        var inParent = Path.Combine(AppContext.BaseDirectory, "..", "Web");
        if (Directory.Exists(inParent)) return Path.GetFullPath(inParent);
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "Web");
            if (Directory.Exists(candidate)) return Path.GetFullPath(candidate);
        }
        return inBase;
    }

    private async Task InitializeAsync()
    {
        try
        {
            var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Hunterstar", "Opener", smokeTest ? "TestWebView" : "WebView");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: dataFolder);
            await browser.EnsureCoreWebView2Async(environment);
            browser.CoreWebView2.SetVirtualHostNameToFolderMapping("opener.local", FindWebFolder(), CoreWebView2HostResourceAccessKind.DenyCors);
            browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
            browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            browser.CoreWebView2.NavigationStarting += (_, e) => e.Cancel = !IsLocalPage(e.Uri);
            browser.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
            browser.CoreWebView2.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            browser.CoreWebView2.DownloadStarting += (_, e) => e.Cancel = true;
            browser.CoreWebView2.WebMessageReceived += ReceiveMessage;
            browser.CoreWebView2.Navigate(LocalOrigin + "/index.html");
            if (smokeTest) await SmokeTestAsync();
        }
        catch (Exception error)
        {
            if (smokeTest) { WriteTestResult(new { ok = false, error = error.Message }); Close(); return; }
            MessageBox.Show(this, "Could not start Account Opener. Make sure Microsoft Edge WebView2 Runtime is installed.\n\n" + error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private static bool IsLocalPage(string source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) && uri.GetLeftPart(UriPartial.Authority) == LocalOrigin && uri.AbsolutePath == "/index.html";

    private async void ReceiveMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsLocalPage(e.Source)) return;
        string? id = null;
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            id = root.GetProperty("id").GetString();
            object result;
            switch (root.GetProperty("action").GetString())
            {
                case "accounts": result = new { accounts = await service.LoadAsync() }; break;
                case "health": result = new { online = OpenerService.ChromePath() != null }; break;
                case "open":
                    var info = service.PrepareLaunch(root.GetProperty("account").GetString() ?? "", root.GetProperty("url").GetString() ?? "");
                    if (!smokeTest) Process.Start(info)?.Dispose();
                    result = new { launched = true }; break;
                default: throw new InvalidOperationException("Unknown desktop request.");
            }
            Reply(new { id, ok = true, result });
        }
        catch (Exception error) { Reply(new { id, ok = false, error = error is OperationCanceledException ? "Firebase timed out. Check your internet connection and retry." : error.Message }); }
    }

    private void Reply(object response)
    {
        if (!IsDisposed && browser.CoreWebView2 != null) browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, Json));
    }

    private async Task SmokeTestAsync()
    {
        for (var i = 0; i < 90; i++)
        {
            await Task.Delay(500);
            var status = await browser.ExecuteScriptAsync("document.body.dataset.loadState || ''");
            if (status == "\"error\"") throw new InvalidOperationException(await browser.ExecuteScriptAsync("document.getElementById('accountGrid').innerText"));
            if (status != "\"ready\"") continue;
            var checks = await browser.ExecuteScriptAsync("runDesktopSmokeChecks()");
            var accounts = await service.LoadAsync();
            var launchCount = 0;
            foreach (var account in accounts)
                foreach (var app in account.EnabledApps) { service.PrepareLaunch(account.ProfileId, app.Url); launchCount++; }
            foreach (var url in new[] { "file:///C:/Windows", "javascript:alert(1)", "http://127.0.0.1/", "http://192.168.0.1/", "http://[::1]/" })
                if (OpenerService.ValidUrl(url)) throw new InvalidOperationException("Unsafe URL accepted in smoke test.");
            try { service.PrepareLaunch("../../invalid", "https://chatgpt.com"); throw new Exception("Invalid profile accepted."); } catch (InvalidOperationException) { }
            var screenshot = Path.Combine(AppContext.BaseDirectory, "smoke-test.png");
            using (var stream = File.Create(screenshot)) await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            using var parsedChecks = JsonDocument.Parse(checks);
            if (!parsedChecks.RootElement.GetProperty("ok").GetBoolean()) throw new InvalidOperationException("UI checks failed: " + checks);
            WriteTestResult(new { ok = true, accountCount = accounts.Count, validatedLaunches = launchCount, uiChecks = parsedChecks.RootElement.Clone(), screenshot });
            Close(); return;
        }
        throw new TimeoutException("Desktop UI did not finish loading.");
    }

    private static void WriteTestResult(object result) => File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "smoke-test.json"), JsonSerializer.Serialize(result, Json));
}
