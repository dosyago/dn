param(
  [string]$exeName,
  [string]$jsSourceFile,
  [string]$outputFolder
)

# Validate parameters
if (-not $exeName) {
  Write-Error "Executable name is required."
  exit 1
}
if (-not $jsSourceFile) {
  Write-Error "JavaScript source file path is required."
  exit 1
}
if (-not $outputFolder) {
  Write-Error "Output folder is required."
  exit 1
}

# Ensure NVM is installed
if (-not (Get-Command nvm -ErrorAction SilentlyContinue)) {
  Write-Output "NVM not found. Installing..."
  Invoke-WebRequest https://raw.githubusercontent.com/coreybutler/nvm-windows/master/nvm-setup.exe -OutFile nvm-setup.exe
  Start-Process -Wait -FilePath nvm-setup.exe
  Remove-Item nvm-setup.exe
}

# Use Node 22
nvm install 22
nvm use 22

# Create sea-config.json
$seaConfigContent = @"
{
  "main": "$jsSourceFile",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true,
  "assets": {
    "index.html": "public/index.html",
    "favicon.ico": "public/favicon.ico",
    "top.html": "public/top.html",
    "style.css": "public/style.css",
    "injection.js": "public/injection.js",
    "redirector.html": "public/redirector.html"
  }
}
"@
$seaConfigContent | Out-File sea-config.json

# Generate the blob
try {
  node --experimental-sea-config sea-config.json
} catch {
  Write-Error "Failed to generate the blob: $_"
  exit 1
}

# Copy node binary
try {
  node -e "require('fs').copyFileSync(process.execPath, '$exeName.exe')"
} catch {
  Write-Error "Failed to copy node binary: $_"
  exit 1
}

# Optionally remove the signature of the binary
signtool remove /s "$exeName.exe"

# Inject the blob
try {
  npx postject "$exeName.exe" NODE_SEA_BLOB sea-prep.blob `
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
} catch {
  Write-Error "Failed to inject the blob: $_"
  exit 1
}

# Optionally sign the binary
signtool sign /fd SHA256 "$exeName.exe"

# Move the executable to the output folder
try {
  Move-Item -Path "$exeName.exe" -Destination (Join-Path -Path $outputFolder -ChildPath "$exeName.exe")
} catch {
  Write-Error "Failed to move the executable: $_"
  exit 1
}

# Clean up
try {
  Remove-Item sea-config.json, sea-prep.blob
} catch {
  Write-Error "Failed to clean up: $_"
  exit 1
}

Write-Output "Process completed successfully."

