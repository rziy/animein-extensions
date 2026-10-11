' Jalankan companion tanpa jendela terminal. Log ke data\companion.log
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
sh.CurrentDirectory = root
sh.Run "cmd /c node src\main.js >> data\companion.log 2>&1", 0, False
