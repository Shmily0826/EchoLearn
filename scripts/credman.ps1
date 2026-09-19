# EchoLearn QA credential helper (Windows Credential Manager, generic credentials)
# Usage:
#   powershell -ExecutionPolicy Bypass -File credman.ps1 write  <target> <username> <password>
#   powershell -ExecutionPolicy Bypass -File credman.ps1 read   <target> <username>   -> prints password to stdout
#   powershell -ExecutionPolicy Bypass -File credman.ps1 delete <target>
#   powershell -ExecutionPolicy Bypass -File credman.ps1 test                        -> capability self-test
param(
  [Parameter(Mandatory=$true)][string]$Action,
  [Parameter(Mandatory=$false)][string]$Target,
  [Parameter(Mandatory=$false)][string]$Username,
  [Parameter(Mandatory=$false)][string]$Password
)

$signature = @"
using System;
using System.Runtime.InteropServices;

public class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, int flags);

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, int type, int flags);

  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr buffer);
}
"@
Add-Type -TypeDefinition $signature

function Write-Cred([string]$target, [string]$user, [string]$pass) {
  $cred = New-Object CredMan+CREDENTIAL
  $cred.Flags = 0
  $cred.Type = 1            # CRED_TYPE_GENERIC
  $cred.TargetName = $target
  $cred.Comment = "EchoLearn QA account (managed; see docs/QA_ACCOUNTS.md)"
  $cred.CredentialBlobSize = [System.Text.Encoding]::Unicode.GetByteCount($pass)
  $cred.CredentialBlob = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni($pass)
  $cred.Persist = 2         # CRED_PERSIST_LOCAL_MACHINE (user-level, survives reboot)
  $cred.AttributeCount = 0
  $cred.UserName = $user
  $ok = [CredMan]::CredWrite([ref]$cred, 0)
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($cred.CredentialBlob)
  if (-not $ok) { throw "CredWrite failed for $target" }
}

function Read-Cred([string]$target, [string]$user) {
  $ptr = [IntPtr]::Zero
  if (-not [CredMan]::CredRead($target, 1, 0, [ref]$ptr)) { throw "CredRead failed for $target" }
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredMan+CREDENTIAL])
  $pass = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)
  [CredMan]::CredFree($ptr)
  if ($cred.UserName -ne $user) { throw "username mismatch for $target" }
  return $pass
}

switch ($Action) {
  'write'  { Write-Cred $Target $Username $Password; Write-Output "WRITTEN $Target" }
  'read'   { Write-Output (Read-Cred $Target $Username) }
  'delete' { if ([CredMan]::CredDelete($Target, 1, 0)) { Write-Output "DELETED $Target" } else { throw "CredDelete failed for $Target" } }
  'test' {
    $t = 'EchoLearn-CredMan-CapTest'
    $u = 'cap-test-user'
    $p = [System.Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
    Write-Cred $t $u $p
    $back = Read-Cred $t $u
    if ($back -ne $p) { [CredMan]::CredDelete($t, 1, 0) | Out-Null; throw 'capability test: read-back mismatch' }
    if ([CredMan]::CredDelete($t, 1, 0)) { Write-Output 'CAPABILITY-TEST PASS (written, read back, deleted)' } else { throw 'capability test: delete failed' }
  }
  default { throw "unknown action $Action" }
}
