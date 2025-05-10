# sign_windows_downloadnet.ps1
# PowerShell script to sign the DownloadNet Windows executable using Azure Sign Tool.

[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='Medium')] # Added ConfirmImpact
param (
    [Parameter(Mandatory=$true, HelpMessage="Path to the DownloadNet executable to sign (e.g., .\build\bin\dn-win.exe)")]
    [string]$ExePath,

    [Parameter(Mandatory=$true, HelpMessage="Azure Key Vault name (e.g., MyDownloadNetKeyVault)")]
    [string]$KeyVaultName,

    [Parameter(Mandatory=$false, HelpMessage="Certificate name in Key Vault. If not provided, the first available certificate will be used.")]
    [string]$CertificateName, # Now optional

    [Parameter(Mandatory=$false, HelpMessage="Azure subscription ID. If not provided, the script will attempt to use the currently active subscription.")]
    [string]$SubscriptionId,

    [Parameter(Mandatory=$false, HelpMessage="Azure resource group name where the Key Vault resides. If not provided, it will be fetched from the Key Vault details.")]
    [string]$ResourceGroup,

    [Parameter(Mandatory=$false, HelpMessage="Service principal application (client) ID. If not provided, interactive login or managed identity will be attempted by AzureSignTool.")]
    [string]$AppId,

    [Parameter(Mandatory=$false, HelpMessage="Service principal client secret. Required if AppId is provided.")]
    [string]$ClientSecret,

    [Parameter(Mandatory=$false, HelpMessage="Azure Active Directory tenant ID. Required if AppId is provided.")]
    [string]$TenantId
)

# --- Configuration ---
$ProjectName = "DownloadNet"
$TimestampServer = "http://timestamp.digicert.com"
$AzureSignToolPath = "AzureSignTool.exe" # Assumes it's in PATH
$SignToolExePath = "signtool.exe"       # Assumes it's in PATH

# --- Helper Functions ---
function Show-Usage {
    Write-Warning "Usage: .\sign_windows_downloadnet.ps1 -ExePath <path-to-exe> -KeyVaultName <kv-name> [-CertificateName <cert-name>] [-SubscriptionId <sub-id>] [-ResourceGroup <rg-name>] [-AppId <app-id> -ClientSecret <secret> -TenantId <tenant-id>]"
    exit 1
}

function Invoke-AzCli {
    param (
        [string]$Command,
        [switch]$AllowNonJsonOutput # Switch to allow commands that don't output JSON
    )
    Write-Verbose "Executing Azure CLI command: az $Command"
    $output = Invoke-Expression "az $Command" # Capture all output
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Azure CLI command failed: az $Command"
        Write-Error "Raw Output: $output"
        throw "Azure CLI command failed."
    }
    if ($AllowNonJsonOutput) {
        return $output # Return raw output if non-JSON is expected
    }
    # Attempt to convert from JSON, handle errors gracefully
    $jsonData = $null
    try {
        $jsonData = $output | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Write-Warning "Output from 'az $Command' was not valid JSON or was empty. Raw output: $output"
        # Depending on the command, this might be acceptable or an error.
        # For commands expected to return JSON, this indicates an issue.
    }
    return $jsonData
}

# --- Parameter Validation ---
if (-not (Test-Path $ExePath -PathType Leaf)) {
    Write-Error "Executable not found or is not a file at path: $ExePath"
    Show-Usage
}

if ($AppId -and (-not $ClientSecret -or -not $TenantId)) {
    Write-Error "If -AppId is provided, -ClientSecret and -TenantId must also be provided."
    Show-Usage
}

# --- Main Script Logic ---
try {
    Write-Host "Starting code signing process for $ProjectName executable: $ExePath" -ForegroundColor Cyan

    # 1. Set/Get Azure Subscription
    if ($SubscriptionId) {
        Write-Host "Setting active Azure subscription to: $SubscriptionId"
        Invoke-AzCli "account set --subscription `"$SubscriptionId`"" -AllowNonJsonOutput # account set might not return JSON
    } else {
        Write-Host "Fetching current active Azure subscription..."
        $currentSub = Invoke-AzCli "account show"
        $SubscriptionId = $currentSub.id
        if (-not $SubscriptionId) { throw "Failed to retrieve active subscription. Ensure you are logged in with 'az login'." }
        Write-Host "Using active subscription: $($currentSub.name) ($SubscriptionId)"
    }

    # 2. Fetch Key Vault Details
    Write-Host "Fetching Key Vault details for: $KeyVaultName"
    $keyVaultDetails = Invoke-AzCli "keyvault show --name `"$KeyVaultName`" --subscription `"$SubscriptionId`""
    $KeyVaultUrl = $keyVaultDetails.properties.vaultUri
    if (-not $KeyVaultUrl) { throw "Failed to retrieve Key Vault URL." }
    Write-Host "Key Vault URL: $KeyVaultUrl"

    if (-not $ResourceGroup) {
        $ResourceGroup = $keyVaultDetails.resourceGroup
        if (-not $ResourceGroup) { throw "Could not retrieve resource group from Key Vault details." }
        Write-Host "Using resource group from Key Vault: $ResourceGroup"
    } else {
        Write-Host "Using provided resource group: $ResourceGroup"
    }

    # 3. Fetch Certificate Name if not provided
    if (-not $CertificateName) {
        Write-Host "CertificateName not provided. Fetching available certificates in Key Vault: $KeyVaultName"
        $certListOutput = Invoke-AzCli "keyvault certificate list --vault-name `"$KeyVaultName`""
        
        if ($LASTEXITCODE -ne 0 -or -not $certListOutput) { # Check $LASTEXITCODE as Invoke-AzCli might not throw for empty JSON list
            throw "Failed to list certificates in Key Vault, or no certificates found."
        }
        
        # Ensure $certListOutput is an array, even if only one cert is returned
        $certificates = @($certListOutput)

        if ($certificates.Count -eq 0) {
            throw "No certificates found in Key Vault: $KeyVaultName"
        }

        Write-Host "Available certificates:"
        $certificates | ForEach-Object { Write-Host "  - $($_.name) (ID: $($_.id))" }
        
        $CertificateName = $certificates[0].name # Use the name of the first certificate
        Write-Host "Using first available certificate: $CertificateName" -ForegroundColor Green
        Write-Host "To use a different certificate, specify it with the -CertificateName parameter."
    } else {
        Write-Host "Using provided certificate name: $CertificateName"
    }


    # 4. Construct AzureSignTool command
    $signToolArgs = @(
        "sign",
        "-kvu", $KeyVaultUrl,
        "-kvc", $CertificateName,
        "-tr", $TimestampServer,
        "-v", # Verbose output from AzureSignTool
        "`"$ExePath`"" 
    )

    if ($AppId) {
        $signToolArgs += @("-kvi", $AppId, "-kvs", $ClientSecret, "-kvt", $TenantId)
        Write-Host "Using Service Principal for authentication."
    } else {
        Write-Host "Using interactive login or managed identity for AzureSignTool authentication."
    }
    
    # 5. Sign the Executable
    if ($PSCmdlet.ShouldProcess($ExePath, "Sign with AzureSignTool (Cert: $CertificateName, KV: $KeyVaultName)")) {
        Write-Host "Attempting to sign the executable..." -ForegroundColor Yellow
        Write-Verbose "Executing: $AzureSignToolPath $($signToolArgs -join ' ')" # For verbose output
        
        $logDir = Join-Path -Path $PSScriptRoot -ChildPath "signing_logs"
        New-Item -ItemType Directory -Path $logDir -ErrorAction SilentlyContinue
        $stdoutLogPath = Join-Path -Path $logDir -ChildPath "azuresigntool_stdout.log"
        $stderrLogPath = Join-Path -Path $logDir -ChildPath "azuresigntool_stderr.log"

        $process = Start-Process -FilePath $AzureSignToolPath -ArgumentList $signToolArgs -Wait -NoNewWindow -PassThru -RedirectStandardOutput $stdoutLogPath -RedirectStandardError $stderrLogPath
        
        $stdoutLog = Get-Content $stdoutLogPath -Raw -ErrorAction SilentlyContinue
        $stderrLog = Get-Content $stderrLogPath -Raw -ErrorAction SilentlyContinue

        Write-Verbose "AzureSignTool STDOUT: $stdoutLog"
        if ($stderrLog) { Write-Warning "AzureSignTool STDERR: $stderrLog" }

        if ($process.ExitCode -ne 0) {
            Write-Error "AzureSignTool failed with exit code $($process.ExitCode)."
            Write-Error "Check logs: $stdoutLogPath and $stderrLogPath"
            throw "Signing failed."
        }
        Write-Host "Executable signed successfully by AzureSignTool." -ForegroundColor Green
    } else {
        Write-Warning "Signing operation skipped due to -WhatIf or user cancellation."
        exit # Exit if -WhatIf was used or user cancelled
    }


    # 6. Verify the Signature
    if ($PSCmdlet.ShouldProcess($ExePath, "Verify signature with signtool.exe")) {
        Write-Host "Verifying the signature using signtool.exe..." -ForegroundColor Yellow
        $verifyArgs = @("verify", "/pa", "`"$ExePath`"")
        
        Write-Verbose "Executing: $SignToolExePath $($verifyArgs -join ' ')"
        $verifyStdoutLogPath = Join-Path -Path $logDir -ChildPath "signtool_verify_stdout.log"
        $verifyStderrLogPath = Join-Path -Path $logDir -ChildPath "signtool_verify_stderr.log"

        $verifyProcess = Start-Process -FilePath $SignToolExePath -ArgumentList $verifyArgs -Wait -NoNewWindow -PassThru -RedirectStandardOutput $verifyStdoutLogPath -RedirectStandardError $verifyStderrLogPath

        $verifyStdoutLog = Get-Content $verifyStdoutLogPath -Raw -ErrorAction SilentlyContinue
        $verifyStderrLog = Get-Content $verifyStderrLogPath -Raw -ErrorAction SilentlyContinue
        
        Write-Verbose "signtool.exe STDOUT: $verifyStdoutLog"
        if ($verifyStderrLog) { Write-Warning "signtool.exe STDERR: $verifyStderrLog" }

        if ($verifyProcess.ExitCode -ne 0) {
            Write-Error "Signature verification failed with signtool.exe. Exit code: $($verifyProcess.ExitCode)."
            Write-Error "Check logs: $verifyStdoutLogPath and $verifyStderrLogPath"
            throw "Signature verification failed."
        }

        Write-Host "Signature verified successfully." -ForegroundColor Green
        Write-Host "signtool.exe output (first few lines from log):"
        Get-Content $verifyStdoutLogPath | Select-Object -First 5 | Write-Host
    } else {
        Write-Warning "Signature verification skipped due to -WhatIf or user cancellation."
    }

} catch {
    Write-Error "An error occurred during the signing process: $($_.Exception.Message)"
    if ($_.ScriptStackTrace) { Write-Error "Stack Trace: $($_.ScriptStackTrace)" }
    exit 1
} finally {
    # Optional: Advise on log files instead of auto-deleting
    if (Test-Path $logDir) {
        Write-Host "Log files are available in: $logDir" -ForegroundColor Gray
    }
}

Write-Host "$ProjectName signing process completed." -ForegroundColor Green
