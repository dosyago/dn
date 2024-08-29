@echo off
setlocal

:: Check for required arguments
if "%~3"=="" (
  echo Usage: %0 executable_name js_source_file output_folder
  exit /b 1
)

:: Define variables from command line arguments
set "EXE_NAME=%~1"
set "JS_SOURCE_FILE=%~2"
set "OUTPUT_FOLDER=%~3"

:: Ensure output folder exists
if not exist "%OUTPUT_FOLDER%" mkdir "%OUTPUT_FOLDER%"

:: Create a JavaScript file
echo console.log(`Hello, %%argv[2]!`); > "%JS_SOURCE_FILE%"

:: Create configuration file for SEA
(
echo { 
echo   "main": "%JS_SOURCE_FILE%", 
echo   "output": "sea-prep.blob", 
echo   "disableExperimentalSEAWarning": true, 
echo   "useCodeCache": true, 
echo   "assets": { 
echo     "index.html": "public/index.html", 
echo     "favicon.ico": "public/favicon.ico", 
echo     "top.html": "public/top.html", 
echo     "style.css": "public/style.css", 
echo     "injection.js": "public/injection.js", 
echo     "redirector.html": "public/redirector.html" 
echo   } 
echo }
) > "%OUTPUT_FOLDER%\%SEA_CONFIG%"

:: Generate the blob to be injected
node --experimental-sea-config "%OUTPUT_FOLDER%\%SEA_CONFIG%"

:: Copy the node executable and rename
node -e "require('fs').copyFileSync(process.execPath, '%OUTPUT_FOLDER%\%EXE_NAME%')"

:: Optionally, remove signature from the binary (use signtool if necessary, or skip this step)
:: signtool remove /s "%OUTPUT_FOLDER%\%EXE_NAME%"

:: Inject the blob into the copied binary
npx postject "%OUTPUT_FOLDER%\%EXE_NAME%" NODE_SEA_BLOB sea-prep.blob ^
    --sentinel-fuse %NODE_SEA_FUSE%

:: Clean up
del "%JS_SOURCE_FILE%"
del "%OUTPUT_FOLDER%\%SEA_CONFIG%"
del sea-prep.blob

echo Application built successfully.

:end

