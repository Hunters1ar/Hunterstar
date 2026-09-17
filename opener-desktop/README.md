# Hunterstar Account Opener for Windows

A C# .NET 10 Windows Forms application. WebView2 renders the original opener HTML/CSS from the local `Web` folder so the appearance stays the same. C# reads Firebase and launches Chrome directly; there is no web server or port 9876 listener. `https://opener.local` is an internal WebView2 mapping, not a hosted website.

## Open

- **Quick launch from root**: Double-click `AccountCenter.exe` at the root of `opener-desktop`. It immediately boots through its embedded relative link into `app\AccountCenter.dll`. No `start.cmd` or terminal script is needed.
- **Standalone from `app/`**: You can also launch `app\AccountCenter.exe` directly inside the `app` folder.
- **Portability**: You can move the entire `opener-desktop` folder anywhere on this PC or to another drive. The app does not rely on any portfolio files, Node.js, or fixed installation paths.
- **Clean structure (no duplicate files)**: All 240+ runtime DLLs and compiled assets live cleanly inside `app/`. The obsolete `publish` folder has been removed.

Requires Windows x64, Microsoft Edge WebView2 Runtime, and Google Chrome. The published package includes the .NET runtime; launching the EXE needs neither Node.js nor the .NET SDK. Building needs .NET 10 SDK. Set `CHROME_PATH` to override Chrome detection.

## Firebase and profiles

Reads `opener_accounts`, ordered by `order`, in project `portfolio-9b8a5`. Existing preset app strings and custom app objects are supported. Account management continues through the existing admin interface. F5 or Ctrl+R reloads accounts.

Credentials are resolved in this order:

1. `GOOGLE_APPLICATION_CREDENTIALS` environment variable.
2. `%LOCALAPPDATA%\Hunterstar\Opener\service-account.json` (configured on this PC).
3. `app\service-account.json` (inside the app folder).
4. `opener-desktop\service-account.json` (in this folder's root).
5. Parent `api\service-account.json` (convenience fallback when inside portfolio).

Because credentials are saved in `%LOCALAPPDATA%\Hunterstar\Opener\service-account.json` and in `opener-desktop\`, moving `opener-desktop` outside the portfolio repository preserves Firebase access completely. Credentials are read only by C#, never sent into WebView2 or copied into public website code. Chrome uses the existing `%USERPROFILE%\.opener-profiles\acct_<12 hex digits>` folders, preserving account sessions.

## Build and verify

```powershell
# Run inside opener-desktop, wherever you move it:
.\build.ps1
.\AccountCenter.exe --smoke-test
```

Smoke mode reads Firebase, checks rendering/search/theme, validates every configured Chrome launch without actually opening Chrome, and writes `smoke-test.json` plus `smoke-test.png` inside `app` before closing. The build script publishes dependencies into `app` and generates the root native executable with its relative `app/AccountCenter.dll` entry point.

The desktop source and launcher are excluded from Vercel deployments. The former `/opener` and `/opener.html` routes and opener subdomain now route to the existing unavailable page. The old public Firebase-backed API endpoint is separate from website hosting; this app does not use it.
