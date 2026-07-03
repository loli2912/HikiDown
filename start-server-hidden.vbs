' Runs start-server.bat with no visible window.
' Works from the project folder OR as a copy/shortcut anywhere (e.g. the
' shell:startup folder) — falls back to the project path if the .bat is not
' next to this script.
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
bat = base & "\start-server.bat"
If Not fso.FileExists(bat) Then
    bat = "C:\Users\fanmo\Downloads\HikiDown\start-server.bat"
End If
If fso.FileExists(bat) Then
    Set sh = CreateObject("WScript.Shell")
    sh.Run """" & bat & """", 0, False
Else
    MsgBox "HikiDown: start-server.bat not found at " & bat, 48, "HikiDown"
End If
