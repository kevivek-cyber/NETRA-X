' NETRA-X silent launcher shim.
'
' The desktop shortcut cannot point straight at PowerShell: powershell.exe is a
' console application, so Windows allocates a console window for it before the
' script gets a chance to hide anything. -WindowStyle Hidden does not help --
' by the time PowerShell parses that argument the window already exists, which
' is why it flashes and then lingers in the taskbar for as long as the app runs.
'
' wscript.exe has no console of its own, so launching PowerShell from here with
' intWindowStyle 0 means no console is ever created. This is the standard shim
' for the problem and needs no compiled helper.
'
' Errors cannot be printed anywhere in this mode, so start-netra-x.ps1 is passed
' -Silent and reports failures through a message box instead.

Option Explicit

Dim shell, fso, here, ps1, cmd
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = fso.BuildPath(here, "start-netra-x.ps1")

If Not fso.FileExists(ps1) Then
    MsgBox "NETRA-X launcher is missing:" & vbCrLf & vbCrLf & ps1, _
           vbCritical, "NETRA-X"
    WScript.Quit 1
End If

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " & _
      "-File """ & ps1 & """ -Silent"

' 0 = hidden window, False = do not wait for it to finish.
shell.Run cmd, 0, False
