# Hunterstar Account Opener for Windows

A C# .NET 10 Windows Forms application. WebView2 renders the original opener HTML/CSS from the local `Web` folder so the appearance stays the same. C# fetches accounts from the self-hosted PostgreSQL API (`/api/opener-accounts`) and launches Chrome directly; there is no web server, no Firebase dependency, and no service-account credentials needed. `https://opener.local` is an internal WebView2 mapping, not a hosted website.

## Open

- **Quick launch from root**: Double-click `AccountCenter.exe` at the root of `opener-desktop`. It immediately boots through its embedded relative link into `app\AccountCenter.dll`. No terminal script is needed.
- **Standalone from `app/`**: You can also launch `app\AccountCenter.exe` directly inside the `app` folder.
- **Portability**: You can move the entire `opener-desktop` folder anywhere on this PC or to another drive. The app does not rely on any portfolio files, Node.js, or fixed installation paths.
- **Clean structure**: All runtime DLLs and compiled assets live cleanly inside `app/`.

Requires Windows x64, Microsoft Edge WebView2 Runtime, and Google Chrome. The published package includes the .NET runtime; launching the EXE needs neither Node.js nor the .NET SDK. Building needs .NET 10 SDK. Set `CHROME_PATH` to override Chrome detection.

## Accounts and profiles

Reads `opener_accounts` from the PostgreSQL-backed API endpoint (`https://api.hunterstar.uz/api/opener-accounts`, configurable via `HUNTERSTAR_API_BASE` or `OPENER_API_BASE`). Existing preset app strings and custom app objects are supported. Account management continues through the existing admin interface. F5 or Ctrl+R reloads accounts.

Chrome uses the existing `%USERPROFILE%\.opener-profiles\acct_<12 hex digits>` folders, preserving account sessions.

## Build and verify

```powershell
# Run inside opener-desktop, wherever you move it:
.\build.ps1
.\AccountCenter.exe --smoke-test
```

Smoke mode loads accounts from the API, checks rendering/search/theme, validates every configured Chrome launch without actually opening Chrome, and writes `smoke-test.json` plus `smoke-test.png` inside `app` before closing.
