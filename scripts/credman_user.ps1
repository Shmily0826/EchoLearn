# Prints the UserName stored under a generic credential target (no password output).
param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
$signature = @"
using System;
using System.Runtime.InteropServices;
public class CredManU {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr buffer);
}
"@
Add-Type -TypeDefinition $signature
$ptr = [IntPtr]::Zero
if (-not [CredManU]::CredRead($Target, 1, 0, [ref]$ptr)) { throw "CredRead failed for $Target" }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManU+CREDENTIAL])
$user = $cred.UserName
[CredManU]::CredFree($ptr)
Write-Output $user
