Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "e:\move\portfolio"
WshShell.Run """C:\Program Files\nodejs\node.exe"" ""e:\move\portfolio\opener-launcher.js""", 0, False
