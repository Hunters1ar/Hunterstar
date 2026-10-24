using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Hunterstar.Opener;

internal sealed record OpenerApp(string Name, string Url, string Icon = "");
internal sealed record OpenerAccount(string Id, string Name, string ProfileId, List<OpenerApp> EnabledApps);

internal sealed class OpenerService
{
    internal static readonly string ProfileRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".opener-profiles");
    private List<OpenerAccount> accounts = [];
    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(20) };
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

    private static string GetApiEndpoint()
    {
        var configured = Environment.GetEnvironmentVariable("HUNTERSTAR_API_BASE")
            ?? Environment.GetEnvironmentVariable("OPENER_API_BASE")
            ?? "https://api.hunterstar.uz";
        return $"{configured.TrimEnd('/')}/api/opener-accounts";
    }

    internal async Task<List<OpenerAccount>> LoadAsync()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        var response = await HttpClient.GetAsync(GetApiEndpoint(), timeout.Token);
        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token);
        var root = doc.RootElement;

        if (!root.TryGetProperty("ok", out var okProp) || !okProp.GetBoolean())
        {
            var error = root.TryGetProperty("error", out var errProp) ? errProp.GetString() : "Failed to load accounts.";
            throw new InvalidOperationException(error);
        }

        var loaded = new List<OpenerAccount>();
        if (root.TryGetProperty("accounts", out var accountsElement) && accountsElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var accountDoc in accountsElement.EnumerateArray())
            {
                var id = accountDoc.TryGetProperty("id", out var idProp) ? idProp.GetString() ?? "" : "";
                var name = accountDoc.TryGetProperty("name", out var nameProp) ? nameProp.GetString() ?? "" : "";
                var profileId = accountDoc.TryGetProperty("profileId", out var profileProp) ? profileProp.GetString() ?? "" : "";
                var apps = new List<OpenerApp>();

                if (accountDoc.TryGetProperty("enabledApps", out var appsElement) && appsElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in appsElement.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.String)
                        {
                            var key = item.GetString()?.Trim() ?? "";
                            if (Presets.TryGetValue(key, out var preset)) apps.Add(preset);
                        }
                        else if (item.ValueKind == JsonValueKind.Object)
                        {
                            var appName = item.TryGetProperty("name", out var n) ? n.GetString()?.Trim() ?? "" : "";
                            var appUrl = item.TryGetProperty("url", out var u) ? u.GetString()?.Trim() ?? "" : "";
                            var appIcon = item.TryGetProperty("icon", out var ic) ? ic.GetString()?.Trim() ?? "" : "";
                            if (appName.Length > 0 && ValidUrl(appUrl))
                            {
                                apps.Add(new(appName[..Math.Min(50, appName.Length)], appUrl, ValidUrl(appIcon) ? appIcon : ""));
                            }
                        }
                    }
                }

                loaded.Add(new(id, name, profileId, apps));
            }
        }

        accounts = loaded;
        return loaded;
    }

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
            throw new InvalidOperationException("This app is not configured for this account. Refresh and try again.");
        var start = new ProcessStartInfo(ChromePath() ?? throw new InvalidOperationException("Google Chrome was not found. Install Chrome or set CHROME_PATH.")) { UseShellExecute = false };
        foreach (var argument in new[] { $"--user-data-dir={Path.Combine(ProfileRoot, profile)}", "--new-window", "--start-maximized", "--no-first-run", "--no-default-browser-check", url }) start.ArgumentList.Add(argument);
        return start;
    }
}
