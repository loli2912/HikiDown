' Starts the HikiDown server with no visible window.
' To auto-start with Windows: press Win+R, type  shell:startup  and put a
' shortcut to this file in that folder.
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = base & "\server"
sh.Run "cmd /c py -3 server.py || python server.py", 0, False
