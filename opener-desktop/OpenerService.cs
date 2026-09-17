using Google.Cloud.Firestore;
using Google.Apis.Auth.OAuth2;
using System.Diagnostics;
using System.Net;
using System.Text.RegularExpressions;

namespace Hunterstar.Opener;

internal sealed record OpenerApp(string Name, string Url, string Icon = "");
internal sealed record OpenerAccount(string Id, string Name, string ProfileId, List<OpenerApp> EnabledApps);

internal sealed class OpenerService
{
    internal static readonly string ProfileRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".opener-profiles");
    private List<OpenerAccount> accounts = [];
    private FirestoreDb? database;
    private static readonly Dictionary<string, OpenerApp> Presets = new(StringComparer.OrdinalIgnoreCase)
    {
        ["chatgpt"] = new("ChatGPT", "https://chatgpt.com"),
        ["claude"] = new("Claude", "https://claude.ai"),
        ["gemini"] = new("Gemini", "https://gemini.google.com/app"),
        ["kimi"] = new("Kimi AI", "https://www.kimi.ai/"),
        ["deepseek"] = new("DeepSeek", "https://chat.deepseek.com"),
        ["grok"] = new("Grok", "https://grok.com"),
        ["copilot"] = new("Copilot", "https://copilot.microsoft.com"),
        ["poe"] = new("Poe", "https://poe.com")
    };

    private static string FindCredentials()
    {
        var configured = Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS");
        if (!string.IsNullOrWhiteSpace(configured))
            return File.Exists(configured) ? configured : throw new InvalidOperationException("GOOGLE_APPLICATION_CREDENTIALS points to a missing file.");

        var candidates = new List<string?>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Hunterstar", "Opener", "service-account.json"),
            Path.Combine(AppContext.BaseDirectory, "service-account.json"),
            Path.Combine(AppContext.BaseDirectory, "..", "service-account.json")
        };

        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            candidates.Add(Path.Combine(dir.FullName, "service-account.json"));
            candidates.Add(Path.Combine(dir.FullName, "api", "service-account.json"));
        }

        foreach (var path in candidates)
        {
            if (!string.IsNullOrEmpty(path) && File.Exists(path))
                return Path.GetFullPath(path);
        }

        throw new InvalidOperationException("Firebase credentials not found. Place service-account.json in opener-desktop or %LOCALAPPDATA%\\Hunterstar\\Opener, or set GOOGLE_APPLICATION_CREDENTIALS to its full path.");
    }

    internal async Task<List<OpenerAccount>> LoadAsync()
    {
        if (database == null)
        {
            using var credentials = File.OpenRead(FindCredentials());
            var credential = GoogleCredential.FromServiceAccountCredential(ServiceAccountCredential.FromServiceAccountData(credentials));
            database = await new FirestoreDbBuilder { ProjectId = "portfolio-9b8a5", GoogleCredential = credential }.BuildAsync();
        }
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        var snapshot = await database.Collection("opener_accounts").OrderBy("order").GetSnapshotAsync(timeout.Token);
        var loaded = new List<OpenerAccount>();
        foreach (var document in snapshot.Documents)
        {
            var data = document.ToDictionary();
            var apps = new List<OpenerApp>();
            if (data.TryGetValue("enabledApps", out var value) && value is IEnumerable<object> values)
                foreach (var item in values)
                {
                    if (item is string key && Presets.TryGetValue(key.Trim(), out var preset)) apps.Add(preset);
                    else if (item is Dictionary<string, object> custom && ValidUrl(Text(custom, "url")))
                    {
                        var name = Text(custom, "name").Trim();
                        if (name.Length > 0) apps.Add(new(name[..Math.Min(50, name.Length)], Text(custom, "url"), ValidUrl(Text(custom, "icon")) ? Text(custom, "icon") : ""));
                    }
                }
            loaded.Add(new(document.Id, Text(data, "name"), Text(data, "profileId"), apps));
        }
        accounts = loaded;
        return loaded;
    }

    private static string Text(Dictionary<string, object> data, string key) => data.TryGetValue(key, out var value) && value is string text ? text : "";

    internal static bool ValidUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http") || uri.UserInfo.Length > 0) return false;
        var host = uri.DnsSafeHost.TrimEnd('.').ToLowerInvariant();
        if (!host.Contains('.') || host.EndsWith(".local") || host.EndsWith(".internal") || host.EndsWith(".lan")) return false;
        if (IPAddress.TryParse(host, out var ip))
        {
            if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
            if (IPAddress.IsLoopback(ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
            var b = ip.GetAddressBytes();
            if (b[0] is 0 or 10 or 127 || b[0] >= 224 || (b[0] == 169 && b[1] == 254) || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168)) return false;
        }
        return true;
    }

    internal static string? ChromePath()
    {
        string[] candidates = [Environment.GetEnvironmentVariable("CHROME_PATH") ?? "",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")];
        return candidates.FirstOrDefault(File.Exists);
    }

    internal ProcessStartInfo PrepareLaunch(string profile, string url)
    {
        if (!Regex.IsMatch(profile, "\\Aacct_[a-f0-9]{12}\\z") || !ValidUrl(url)) throw new InvalidOperationException("Invalid account or URL.");
        if (!accounts.Any(account => account.ProfileId == profile && account.EnabledApps.Any(app => app.Url == url)))
            throw new InvalidOperationException("This app is not configured for this account in Firebase. Refresh and try again.");
        var start = new ProcessStartInfo(ChromePath() ?? throw new InvalidOperationException("Google Chrome was not found. Install Chrome or set CHROME_PATH.")) { UseShellExecute = false };
        foreach (var argument in new[] { $"--user-data-dir={Path.Combine(ProfileRoot, profile)}", "--new-window", "--start-maximized", "--no-first-run", "--no-default-browser-check", url }) start.ArgumentList.Add(argument);
        return start;
    }
}
