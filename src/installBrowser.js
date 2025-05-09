import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { readFile } from 'fs/promises';
import https from 'node:https';

// Constants
const execPromise = promisify(exec);

const SUPPORTED_BROWSERS = ['chrome', 'brave', 'vivaldi', 'edge', 'chromium'];
const PLATFORM = process.platform; // 'win32', 'darwin', 'linux'
const ARCH = process.arch; // 'x64', 'arm64', etc.

// Logic
// None; function is exported for use

// Functions
export async function installBrowser(browserName) {
  if (!SUPPORTED_BROWSERS.includes(browserName)) {
    throw new Error(`Unsupported browser: ${browserName}. Supported: ${SUPPORTED_BROWSERS.join(', ')}`);
  }

  console.log(`Installing ${browserName} on ${PLATFORM} (${ARCH})...`);

  await checkBrowserAvailability(browserName);
  const binaryPath = await installBrowserForPlatform(browserName);
  console.log(`${browserName} installed at: ${binaryPath}`);
  return binaryPath;
}

async function checkBrowserAvailability(browserName) {
  if (PLATFORM === 'linux' && ARCH === 'arm64' && browserName === 'chrome') {
    throw new Error('Chrome is not available for ARM64 Linux. Try Brave or Chromium instead.');
  }
  // Add more checks for other browsers if needed (e.g., Vivaldi ARM64 stability)
}

async function installBrowserForPlatform(browserName) {
  if (PLATFORM === 'win32') {
    return await installOnWindows(browserName);
  } else if (PLATFORM === 'darwin') {
    return await installOnMacOS(browserName);
  } else if (PLATFORM === 'linux') {
    return await installOnLinux(browserName);
  } else {
    throw new Error(`Unsupported platform: ${PLATFORM}`);
  }
}

async function installOnWindows(browserName) {
  try {
    // Check if winget is installed
    try {
      await execPromise('winget --version');
    } catch {
      console.log('winget not found. Installing winget...');
      await execPromise('powershell -Command "irm asheroto.com/winget | iex"');
      console.log('winget installed successfully.');
    }

    if (browserName === 'chrome') {
      await execPromise('winget install Google.Chrome --silent --accept-package-agreements --accept-source-agreements');
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else if (browserName === 'brave') {
      await execPromise('winget install Brave.Brave --silent --accept-package-agreements --accept-source-agreements');
      return 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
    } else if (browserName === 'vivaldi') {
      await execPromise('winget install Vivaldi.Vivaldi --silent --accept-package-agreements --accept-source-agreements');
      return 'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe';
    } else if (browserName === 'edge') {
      await execPromise('winget install Microsoft.Edge --silent --accept-package-agreements --accept-source-agreements');
      return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    } else if (browserName === 'chromium') {
      const url = getDownloadUrl(browserName, PLATFORM, ARCH);
      if (!url) throw new Error('Chromium download not supported on Windows');
      const outputPath = 'C:\\Program Files\\Chromium\\chromium.exe';
      await downloadBinary(url, outputPath);
      return outputPath;
    }
  } catch (error) {
    console.error(`Windows install failed: ${error.message}`);
    throw error;
  }
}

async function installOnMacOS(browserName) {
  try {
    // Check if brew is installed
    try {
      await execPromise('brew --version');
    } catch {
      throw new Error('Homebrew is not installed. Please install it from https://brew.sh and try again.');
    }

    if (browserName === 'chrome') {
      await execPromise('brew install --cask google-chrome');
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (browserName === 'brave') {
      await execPromise('brew install --cask brave-browser');
      return '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
    } else if (browserName === 'vivaldi') {
      await execPromise('brew install --cask vivaldi');
      return '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi';
    } else if (browserName === 'edge') {
      await execPromise('brew install --cask microsoft-edge');
      return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    } else if (browserName === 'chromium') {
      await execPromise('brew install --cask chromium');
      return '/Applications/Chromium.app/Contents/MacOS/Chromium';
    }
  } catch (error) {
    console.error(`macOS install failed: ${error.message}`);
    throw error;
  }
}

async function installOnLinux(browserName) {
  try {
    const distro = await getLinuxDistro();
    if (distro === 'debian') {
      return await installOnDebian(browserName);
    } else if (distro === 'fedora') {
      return await installOnFedora(browserName);
    } else {
      throw new Error(`Unsupported Linux distribution: ${distro}`);
    }
  } catch (error) {
    console.error(`Linux install failed: ${error.message}`);
    throw error;
  }
}

async function installOnDebian(browserName) {
  let binaryPath = '/usr/bin/' + browserName;
  if (browserName === 'chrome') {
    await execPromise('wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -');
    await execPromise(`sudo sh -c 'echo "deb [arch=${ARCH === 'arm64' ? 'arm64' : 'amd64'}] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'`);
    await execPromise('sudo apt-get update && sudo apt-get install -y google-chrome-stable');
    binaryPath = '/usr/bin/google-chrome';
  } else if (browserName === 'brave') {
    await execPromise('sudo curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg');
    await execPromise(`echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg arch=${ARCH === 'arm64' ? 'arm64' : 'amd64'}] https://brave-browser-apt-release.s3.brave.com/ stable main" | sudo tee /etc/apt/sources.list.d/brave-browser-release.list`);
    await execPromise('sudo apt update && sudo apt install -y brave-browser');
    binaryPath = '/usr/bin/brave-browser';
  } else if (browserName === 'vivaldi') {
    await execPromise('wget -qO- https://repo.vivaldi.com/archive/linux_signing_key.pub | sudo apt-key add -');
    await execPromise(`sudo add-apt-repository "deb [arch=${ARCH === 'arm64' ? 'arm64' : 'amd64'}] https://repo.vivaldi.com/archive/deb/ stable main"`);
    await execPromise('sudo apt update && sudo apt install -y vivaldi-stable');
    binaryPath = '/usr/bin/vivaldi';
  } else if (browserName === 'edge') {
    await execPromise('curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg');
    await execPromise('sudo mv microsoft.gpg /usr/share/keyrings/microsoft-archive-keyring.gpg');
    await execPromise(`sudo sh -c 'echo "deb [arch=${ARCH === 'arm64' ? 'arm64' : 'amd64'} signed-by=/usr/share/keyrings/microsoft-archive-keyring.gpg] https://packages.microsoft.com/repos/edge stable main" > /etc/apt/sources.list.d/microsoft-edge.list'`);
    await execPromise('sudo apt update && sudo apt install -y microsoft-edge-stable');
    binaryPath = '/usr/bin/microsoft-edge';
  } else if (browserName === 'chromium') {
    await execPromise('sudo apt update && sudo apt install -y chromium-browser');
    // Check for Snap installation
    try {
      const { stdout } = await execPromise('which chromium');
      binaryPath = stdout.trim();
      if (binaryPath.includes('/snap/')) {
        binaryPath = '/snap/bin/chromium';
      } else {
        binaryPath = '/usr/bin/chromium-browser';
      }
    } catch {
      binaryPath = '/usr/bin/chromium-browser';
    }
  }
  return binaryPath;
}

async function installOnFedora(browserName) {
  let binaryPath = '/usr/bin/' + browserName;
  if (browserName === 'chrome') {
    await execPromise('sudo dnf config-manager --add-repo https://dl.google.com/linux/chrome/rpm/stable/x86_64');
    await execPromise('sudo rpm --import https://dl.google.com/linux/linux_signing_key.pub');
    await execPromise('sudo dnf install -y google-chrome-stable');
    binaryPath = '/usr/bin/google-chrome';
  } else if (browserName === 'brave') {
    await execPromise('sudo dnf config-manager --add-repo https://brave-browser-rpm-release.s3.brave.com/x86_64/');
    await execPromise('sudo rpm --import https://brave-browser-rpm-release.s3.brave.com/brave-core.asc');
    await execPromise('sudo dnf install -y brave-browser');
    binaryPath = '/usr/bin/brave-browser';
  } else if (browserName === 'vivaldi') {
    await execPromise('sudo dnf config-manager --add-repo https://repo.vivaldi.com/archive/vivaldi-fedora.repo');
    await execPromise('sudo dnf install -y vivaldi-stable');
    binaryPath = '/usr/bin/vivaldi';
  } else if (browserName === 'edge') {
    await execPromise('sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc');
    await execPromise('sudo dnf config-manager --add-repo https://packages.microsoft.com/yumrepos/edge');
    await execPromise('sudo dnf install -y microsoft-edge-stable');
    binaryPath = '/usr/bin/microsoft-edge';
  } else if (browserName === 'chromium') {
    await execPromise('sudo dnf install -y chromium');
    binaryPath = '/usr/bin/chromium-browser';
  }
  return binaryPath;
}

async function getLinuxDistro() {
  try {
    const osRelease = await readFile('/etc/os-release', 'utf8');
    const lines = osRelease.split('\n');
    const releaseInfo = {};
    for (const line of lines) {
      const [key, value] = line.split('=');
      if (key && value) {
        releaseInfo[key] = value.replace(/"/g, '');
      }
    }

    if (releaseInfo.ID === 'fedora' || releaseInfo.ID_LIKE?.includes('fedora')) {
      return 'fedora';
    } else if (releaseInfo.ID === 'debian' || releaseInfo.ID === 'ubuntu' || releaseInfo.ID_LIKE?.includes('debian')) {
      return 'debian';
    } else {
      return releaseInfo.ID || 'unknown';
    }
  } catch (error) {
    console.error(`Failed to read /etc/os-release: ${error.message}`);
    return 'unknown';
  }
}

// Helper functions
async function downloadBinary(url, outputPath) {
  const response = await fetch(url, {
    agent: url.startsWith('https:') ? new https.Agent({ keepAlive: true }) : undefined
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(outputPath));
}

function getDownloadUrl(browserName, platform, arch) {
  const urls = {
    chrome: {
      win32: { x64: 'https://dl.google.com/chrome/install/ChromeSetup.exe', arm64: 'https://dl.google.com/chrome/install/ChromeSetup.exe' },
      darwin: { x64: 'https://dl.google.com/chrome/mac/stable/GGRO/googlechrome.dmg', arm64: 'https://dl.google.com/chrome/mac/arm64/googlechrome.dmg' },
      linux: { x64: 'https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb', arm64: null }
    },
    brave: {
      win32: { x64: 'https://referrals.brave.com/latest/BraveBrowserSetup.exe', arm64: 'https://referrals.brave.com/latest/BraveBrowserSetup.exe' },
      darwin: { x64: 'https://laptop-updates.brave.com/latest/osx/Brave-Browser.dmg', arm64: 'https://laptop-updates.brave.com/latest/osx-arm64/Brave-Browser.dmg' },
      linux: { x64: 'https://laptop-updates.brave.com/latest/linux64', arm64: 'https://laptop-updates.brave.com/latest/linux-arm64' }
    },
    vivaldi: {
      win32: { x64: 'https://downloads.vivaldi.com/stable/Vivaldi_Setup.exe', arm64: 'https://downloads.vivaldi.com/stable/Vivaldi_Setup.exe' },
      darwin: { x64: 'https://downloads.vivaldi.com/stable/Vivaldi.dmg', arm64: 'https://downloads.vivaldi.com/stable/Vivaldi.dmg' },
      linux: { x64: 'https://downloads.vivaldi.com/stable/vivaldi-stable_amd64.deb', arm64: 'https://downloads.vivaldi.com/stable/vivaldi-stable_arm64.deb' }
    },
    edge: {
      win32: { x64: 'https://go.microsoft.com/fwlink/?linkid=2069148', arm64: 'https://go.microsoft.com/fwlink/?linkid=2069148' },
      darwin: { x64: 'https://go.microsoft.com/fwlink/?linkid=2069324', arm64: 'https://go.microsoft.com/fwlink/?linkid=2069324' },
      linux: { x64: 'https://packages.microsoft.com/repos/edge/pool/main/m/microsoft-edge-stable/microsoft-edge-stable_latest_amd64.deb', arm64: 'https://packages.microsoft.com/repos/edge/pool/main/m/microsoft-edge-stable/microsoft-edge-stable_latest_arm64.deb' }
    },
    chromium: {
      win32: { x64: 'https://download-chromium.appspot.com/dl/Win_x64?type=snapshots', arm64: 'https://download-chromium.appspot.com/dl/Win_arm64?type=snapshots' },
      darwin: { x64: 'https://download-chromium.appspot.com/dl/Mac?type=snapshots', arm64: 'https://download-chromium.appspot.com/dl/Mac_Arm?type=snapshots' },
      linux: { x64: 'https://download-chromium.appspot.com/dl/Linux_x64?type=snapshots', arm64: 'https://download-chromium.appspot.com/dl/Linux_Arm?type=snapshots' }
    }
  };
  return urls[browserName]?.[platform]?.[arch] || null;
}
