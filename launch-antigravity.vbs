Set WshShell = CreateObject("WScript.Shell")

' 1. Start HUD daemon silently
WshShell.Run """C:\Users\uglygrave\AppData\Local\Programs\Portable\node-v22.18.0-win-x64\node.exe"" ""C:\Users\uglygrave\.antigravity-tokens-hud\index.js""", 0, False

' 2. Reconstruct arguments for Antigravity
Dim args, i
args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " """ & WScript.Arguments(i) & """"
Next

' 3. Launch Antigravity.exe
WshShell.Run """C:\Users\uglygrave\AppData\Local\Programs\antigravity\Antigravity.exe""" & args, 1, False
