# sign_windows_downloadnet.ps1
# PowerShell script to sign the DownloadNet Windows executable using Azure Sign Tool.

[CmdletBinding(SupportsShouldProcess=$true)]
param (
    [Parameter(Mandatory=$true, HelpMessage="Path to the DownloadNet executable to sign (e.g., .\build\bin\dn-win.exe)")]
    [string]$ExePath,

    [Parameter(Mandatory=$true, HelpMessage="Azure Key Vault name (e.g., MyDownloadNetKeyVault)")]
    [string]$KeyVaultName,

    [Parameter(Mandatory=$true, HelpMessage="Certificate name in Key Vault (e.g., DownloadNetCodeSignCert)")]
    [string]$CertificateName,

    [Parameter(Mandatory=$false, HelpMessage="Azure subscription ID. If not provided, the script will attempt to use the currently active subscription.")]
    [string]$SubscriptionId,

    [Parameter(Mandatory=$false, HelpMessage="Azure resource group name where the Key Vault resides. If not provided, it will be fetched from the Key Vault details.")]
    [string]$ResourceGroup,

    [Parameter(Mandatory=$false, HelpMessage="Service principal application (client) ID. If not provided, interactive login or managed identity will be attempted by AzureSignTool, or you can create an SPN manually.")]
    [string]$AppId,

    [Parameter(Mandatory=$false, HelpMessage="Service principal client secret. Required if AppId is provided.")]
    [string]$ClientSecret, # Renamed from Password for clarity

    [Parameter(Mandatory=$false, HelpMessage="Azure Active Directory tenant ID. Required if AppId is provided.")]
    [string]$TenantId # Renamed from Tenant for clarity
)

# --- Configuration ---
$ProjectName = "DownloadNet"
$TimestampServer = "http://timestamp.digicert.com" # Standard timestamp server
# Path to AzureSignTool.exe if not in PATH. Example:
# $AzureSignToolPath = "C:\path\to\AzureSignTool.exe" 
$AzureSignToolPath = "AzureSignTool.exe" # Assumes it's in PATH

# Path to signtool.exe if not in PATH. Example:
# $SignToolExePath = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
$SignToolExePath = "signtool.exe" # Assumes it's in PATH


# --- Helper Functions ---
function Show-Usage {
    Write-Warning "Usage: .\sign_windows_downloadnet.ps1 -ExePath <path-to-exe> -KeyVaultName <kv-name> -CertificateName <cert-name> [-SubscriptionId <sub-id>] [-ResourceGroup <rg-name>] [-AppId <app-id> -ClientSecret <secret> -TenantId <tenant-id>]"
    # Add more detailed parameter descriptions if needed
    exit 1
}

function Invoke-AzCli {
    param (
        [string]$Command
    )
    Write-Verbose "Executing Azure CLI command: az $Command"
    $output = Invoke-Expression "az $Command"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Azure CLI command failed: az $Command"
        Write-Error "Output: $output"
        throw "Azure CLI command failed." # Throw to stop script execution
    }
    return $output | ConvertFrom-Json -ErrorAction SilentlyContinue # Handle cases where output might not be JSON
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
        Invoke-Expression "az account set --subscription `"$SubscriptionId`""
        if ($LASTEXITCODE -ne 0) { throw "Failed to set active subscription." }
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

    # 3. Construct AzureSignTool command
    $signToolArgs = @(
        "sign",
        "-kvu", $KeyVaultUrl,
        "-kvc", $CertificateName,
        "-tr", $TimestampServer,
        "-v", # Verbose output from AzureSignTool
        "`"$ExePath`"" # Ensure ExePath is quoted if it contains spaces
    )

    if ($AppId) {
        $signToolArgs += @("-kvi", $AppId, "-kvs", $ClientSecret, "-kvt", $TenantId)
        Write-Host "Using Service Principal for authentication."
    } else {
        Write-Host "Using interactive login or managed identity for AzureSignTool authentication (ensure you are logged in via browser if prompted, or Azure CLI)."
        # AzureSignTool will attempt to use Azure CLI context or prompt for interactive login if SPN not provided.
    }
    
    # Note: The original script created an SPN and set policies.
    # This is often a one-time setup or managed separately for security.
    # This revised script assumes the SPN (if used) already exists and has permissions,
    # or relies on interactive/managed identity.
    # If you need SPN creation/policy setting, that logic can be re-added or run as a separate setup script.

    # 4. Sign the Executable
    Write-Host "Attempting to sign the executable..." -ForegroundColor Yellow
    Write-Verbose "Executing: $AzureSignToolPath $signToolArgs"
    
    # Using Start-Process to handle executable paths with spaces correctly and capture output
    $process = Start-Process -FilePath $AzureSignToolPath -ArgumentList $signToolArgs -Wait -NoNewWindow -PassThru -RedirectStandardOutput "$PSScriptRoot\azuresigntool_stdout.log" -RedirectStandardError "$PSScriptRoot\azuresigntool_stderr.log"
    
    $stdoutLog = Get-Content "$PSScriptRoot\azuresigntool_stdout.log" -Raw -ErrorAction SilentlyContinue
    $stderrLog = Get-Content "$PSScriptRoot\azuresigntool_stderr.log" -Raw -ErrorAction SilentlyContinue

    Write-Verbose "AzureSignTool STDOUT: $stdoutLog"
    if ($stderrLog) {
        Write-Warning "AzureSignTool STDERR: $stderrLog"
    }

    if ($process.ExitCode -ne 0) {
        Write-Error "AzureSignTool failed with exit code $($process.ExitCode)."
        Write-Error "Check logs: azuresigntool_stdout.log and azuresigntool_stderr.log in $($PSScriptRoot)"
        throw "Signing failed."
    }
    Write-Host "Executable signed successfully by AzureSignTool." -ForegroundColor Green


    # 5. Verify the Signature
    Write-Host "Verifying the signature using signtool.exe..." -ForegroundColor Yellow
    # Ensure $SignToolExePath is correct or signtool.exe is in PATH
    $verifyArgs = @("verify", "/pa", "`"$ExePath`"") # /pa enforces default Authenticode verification policy
    
    Write-Verbose "Executing: $SignToolExePath $verifyArgs"
    $verifyProcess = Start-Process -FilePath $SignToolExePath -ArgumentList $verifyArgs -Wait -NoNewWindow -PassThru -RedirectStandardOutput "$PSScriptRoot\signtool_verify_stdout.log" -RedirectStandardError "$PSScriptRoot\signtool_verify_stderr.log"

    $verifyStdoutLog = Get-Content "$PSScriptRoot\signtool_verify_stdout.log" -Raw -ErrorAction SilentlyContinue
    $verifyStderrLog = Get-Content "$PSScriptRoot\signtool_verify_stderr.log" -Raw -ErrorAction SilentlyContinue
    
    Write-Verbose "signtool.exe STDOUT: $verifyStdoutLog"
    if ($verifyStderrLog) {
        Write-Warning "signtool.exe STDERR: $verifyStderrLog"
    }

    if ($verifyProcess.ExitCode -ne 0) {
        Write-Error "Signature verification failed with signtool.exe. Exit code: $($verifyProcess.ExitCode)."
        Write-Error "Check logs: signtool_verify_stdout.log and signtool_verify_stderr.log in $($PSScriptRoot)"
        throw "Signature verification failed."
    }

    Write-Host "Signature verified successfully." -ForegroundColor Green
    Write-Host "signtool.exe output (first few lines):"
    Get-Content "$PSScriptRoot\signtool_verify_stdout.log" | Select-Object -First 5 | Write-Host


} catch {
    Write-Error "An error occurred during the signing process: $($_.Exception.Message)"
    # Consider logging $_.ScriptStackTrace for detailed debugging
    exit 1
} finally {
    # Optional: Clean up log files
    # Remove-Item "$PSScriptRoot\azuresigntool_stdout.log" -ErrorAction SilentlyContinue
    # Remove-Item "$PSScriptRoot\azuresigntool_stderr.log" -ErrorAction SilentlyContinue
    # Remove-Item "$PSScriptRoot\signtool_verify_stdout.log" -ErrorAction SilentlyContinue
    # Remove-Item "$PSScriptRoot\signtool_verify_stderr.log" -ErrorAction SilentlyContinue
}

Write-Host "DownloadNet signing process completed." -ForegroundColor Green
