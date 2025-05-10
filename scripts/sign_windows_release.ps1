param (
    [Parameter(Mandatory=$true)]
    [string]$ExePath,

    [Parameter(Mandatory=$true)]
    [string]$KeyVaultName,

    [string]$SubscriptionId,
    [string]$ResourceGroup,
    [string]$CertificateName,
    [string]$AppId,
    [string]$ClientSecret,
    [string]$TenantId,

    # --- Version Info Metadata ---
    [string]$CompanyName = "DOSAYGO",
    [string]$ProductName = "DownloadNet",
    [string]$FileDescription = "Offline full-text search archive of what you browse",
    [string]$FileVersion = "4.5.1.0",
    [string]$ProductVersion = "4.5.1.0",

    # --- Signature Metadata ---
    [string]$SignatureDescription = "DownloadNet - offline full-text search archive of the web for you.",
    [string]$SignatureUrl = "https://github.com/DO-SAY-GO/dn"
)

# --- Function to check/install resedit-cli via npm ---
function Ensure-ReseditInstalled {
    $isInstalled = Get-Command "resedit" -ErrorAction SilentlyContinue

    if (-not $isInstalled) {
        Write-Host "resedit-cli not found. Attempting to install with npm..." -ForegroundColor Yellow
        npm i -g resedit-cli
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to install resedit-cli using npm. Ensure npm is installed and accessible."
            exit 1
        }
        # Refresh PATH to include newly installed resedit-cli
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    } else {
        Write-Host "resedit-cli is already installed." -ForegroundColor Green
    }
}

# --- Call resedit-cli to update version metadata ---
function Set-VersionMetadata {
    Ensure-ReseditInstalled

    Write-Host "Setting executable metadata using resedit-cli..." -ForegroundColor Yellow
    $tempOutput = "$ExePath.tmp.exe"
    $reseditArgs = @(
        "--in", "`"$ExePath`"",
        "--out", "`"$tempOutput`"",
        "--company-name", "`"$CompanyName`"",
        "--product-name", "`"$ProductName`"",
        "--file-description", "`"$FileDescription`"",
        "--file-version", "`"$FileVersion`"",
        "--product-version", "`"$ProductVersion`""
    )

    $reseditCommand = "resedit $reseditArgs"
    Write-Verbose "Executing: $reseditCommand"
    Invoke-Expression $reseditCommand

    if ($LASTEXITCODE -ne 0) {
        Write-Error "resedit-cli failed to apply version metadata."
        if (Test-Path $tempOutput) { Remove-Item $tempOutput -Force }
        exit 1
    }

    # Replace original file with updated one
    Move-Item -Path $tempOutput -Destination $ExePath -Force
    Write-Host "Version metadata applied successfully." -ForegroundColor Green
}

# --- RUN METADATA SETTING STEP FIRST ---
Set-VersionMetadata

# --- Configuration (Defaults from original script) ---
$DefaultSPNName = "CodeSigningSP" # Original SPN name
$TimestampServer = "http://timestamp.digicert.com"
$AzureSignToolExe = "AzureSignTool.exe" # Assumes in PATH
$SignToolExe = "signtool.exe"           # Assumes in PATH

# --- Original Script's Flow (unchanged) ---

function Show-Usage {
    Write-Host "Usage: .\sign_windows_downloadnet_configurable_metadata.ps1 -ExePath <path> -KeyVaultName <kv-name> [-SubscriptionId <sub-id>] [-ResourceGroup <rg>] [-CertificateName <cert-name>] [-AppId <id> -ClientSecret <secret> -TenantId <tenant>] [-SignatureDescription <desc>] [-SignatureUrl <url>]"
    exit 1
}

if (-not $ExePath -or -not $KeyVaultName) { Show-Usage }
if ($AppId -and (-not $ClientSecret -or -not $TenantId)) { Write-Error "Error: If -AppId is provided, -ClientSecret and -TenantId must also be provided."; Show-Usage }
if (-not (Test-Path $ExePath -PathType Leaf)) { Write-Error "Error: Executable not found at path: $ExePath"; exit 1 }

if (-not $SubscriptionId) {
    Write-Host "Fetching the active Azure subscription..."
    $subscriptionOutput = az account show | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0 -or !$subscriptionOutput.id) { Write-Error "Error: Failed to retrieve active subscription. Ensure 'az' CLI is installed and you are logged in with 'az login'."; exit 1 }
    $SubscriptionId = $subscriptionOutput.id
    Write-Host "Using active subscription ID: $SubscriptionId"
}

Write-Host "Setting active subscription to: $SubscriptionId"
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { Write-Error "Error: Failed to set active subscription."; exit 1 }

Write-Host "Fetching Key Vault details for: $KeyVaultName"
$keyVaultOutput = az keyvault show --name $KeyVaultName --subscription $SubscriptionId | ConvertFrom-Json -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0 -or !$keyVaultOutput.properties.vaultUri) { Write-Error "Error: Failed to retrieve Key Vault details."; exit 1 }
$KeyVaultUrl = $keyVaultOutput.properties.vaultUri
Write-Host "Key Vault URL: $KeyVaultUrl"

if (-not $ResourceGroup) {
    $ResourceGroup = $keyVaultOutput.resourceGroup
    if (-not $ResourceGroup) { Write-Error "Error: Could not retrieve resource group from Key Vault details."; exit 1 }
    Write-Host "Using resource group from Key Vault: $ResourceGroup"
}

if (-not $CertificateName) {
    Write-Host "CertificateName not provided. Fetching available certificates in Key Vault: $KeyVaultName"
    $certListOutput = az keyvault certificate list --vault-name $KeyVaultName | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0 -or !$certListOutput) { Write-Error "Error: Failed to list certificates in Key Vault, or no certificates found."; exit 1 }
    $certificates = @($certListOutput)
    if ($certificates.Count -eq 0) { Write-Error "Error: No certificates found in Key Vault: $KeyVaultName"; exit 1 }
    Write-Host "Available certificates:"
    $certificates | ForEach-Object { Write-Host "  - $($_.name)" }
    $CertificateName = $certificates[0].name
    Write-Host "Using first available certificate: $CertificateName" -ForegroundColor Green
}

if (-not $AppId) {
    Write-Host "Service Principal AppId not provided. Creating a new service principal named '$DefaultSPNName'..."
    $scope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.KeyVault/vaults/$KeyVaultName"
    # Using "Contributor" role as in the original script.
    # For production, consider least privilege (e.g., custom role with only cert get & key sign).
    $spnOutput = az ad sp create-for-rbac --name $DefaultSPNName --role Contributor --scopes $scope | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0 -or !$spnOutput.appId) { Write-Error "Error: Failed to create service principal."; exit 1 }
    $AppId = $spnOutput.appId
    $ClientSecret = $spnOutput.password
    $TenantId = $spnOutput.tenant
    Write-Host "Service principal '$DefaultSPNName' created successfully." -ForegroundColor Green
    Write-Host "AppId   : $AppId"
    Write-Host "Secret  : $ClientSecret (Note: This secret is shown only once. Store it securely.)"
    Write-Host "TenantId: $TenantId"

    # Grant permissions using set-policy as in the original script
    Write-Host "Setting Key Vault access policy for SPN '$AppId'..."
    az keyvault set-policy --name $KeyVaultName --spn $AppId --key-permissions sign --certificate-permissions get
    if ($LASTEXITCODE -ne 0) { Write-Error "Error: Failed to set Key Vault policy."; exit 1 }
    Write-Host "Key Vault access policy set successfully." -ForegroundColor Green
}

# --- Construct AzureSignTool command with metadata flags ---
$signToolBaseArgs = @(
    "sign",
    "-kvu", "`"$KeyVaultUrl`"",
    "-kvi", "`"$AppId`"",
    "-kvs", "`"$ClientSecret`"", # ClientSecret might contain special characters
    "-kvt", "`"$TenantId`"",
    "-kvc", "`"$CertificateName`"",
    "-tr", "`"$TimestampServer`""
)
# Add description if provided
if ($SignatureDescription) {
    $signToolBaseArgs += "-d", "`"$SignatureDescription`""
}
# Add description URL if provided
if ($SignatureUrl) {
    $signToolBaseArgs += "-du", "`"$SignatureUrl`""
}
# Add verbose flag and executable path
$signToolBaseArgs += "-v", "`"$ExePath`""

$signCommand = "$AzureSignToolExe $($signToolBaseArgs -join ' ')"

Write-Host "Signing the executable: $ExePath (Cert: $CertificateName, KV: $KeyVaultName)" -ForegroundColor Yellow
Write-Verbose "Executing: $signCommand"
$signOutput = Invoke-Expression $signCommand

if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: Failed to sign the executable with AzureSignTool. Exit code: $LASTEXITCODE"
    Write-Error "AzureSignTool Output: $signOutput"
    exit 1
}
Write-Host "Executable signed successfully by AzureSignTool." -ForegroundColor Green
$signOutput | Write-Host

Write-Host "Verifying the signature using $SignToolExe..." -ForegroundColor Yellow
$verifyCommand = "$SignToolExe verify /pa `"$ExePath`""
Write-Verbose "Executing: $verifyCommand"
$verifyOutput = Invoke-Expression $verifyCommand

if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: Signature verification failed with $SignToolExe. Exit code: $LASTEXITCODE"
    Write-Error "$SignToolExe Output: $verifyOutput"
    exit 1
}
Write-Host "Signature verified successfully by $SignToolExe." -ForegroundColor Green
$verifyOutput | Write-Host

Write-Host "Signing process completed." -ForegroundColor Green
