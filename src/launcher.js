import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import inquirer from 'inquirer';
import { installBrowser } from './installBrowser.js';
import { DEBUG } from './common.js';
import { root } from './root.js';

// Constants
const execPromise = promisify(exec);

const browserPaths = {
  chrome: {
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
  },
  brave: {
    win32: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    darwin: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    linux: '/usr/bin/brave-browser',
  },
  vivaldi: {
    win32: 'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
    darwin: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
    linux: '/usr/bin/vivaldi',
  },
  edge: {
    win32: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    darwin: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    linux: '/usr/bin/microsoft-edge',
  },
  chromium: {
    win32: 'C:\\Program Files\\Chromium\\chromium.exe',
    darwin: '/Applications/Chromium.app/Contents/MacOS/Chromium',
    linux: '/usr/bin/chromium-browser',
  },
};

// Logic
// None; functions are exported or called in run()

// Functions
const getBrowserPath = (browser) => {
  const platform = os.platform();
  return browserPaths[browser]?.[platform] || null;
};

const isBrowserInstalled = async (browser) => {
  const browserPath = getBrowserPath(browser);
  if (!browserPath) return false;

  try {
    await fs.promises.stat(browserPath);
    return true;
  } catch {
    // Fallback: Try system command to locate binary
    try {
      const cmd = os.platform() === 'win32' ? `where ${browser}` : `which ${browser}`;
      const { stdout } = await execPromise(cmd);
      const foundPath = stdout.trim();
      if (foundPath && foundPath !== browserPath) {
        // Update browserPaths with discovered path
        browserPaths[browser][os.platform()] = foundPath;
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
};

const getInstalledBrowsers = async () => {
  const browsers = Object.keys(browserPaths);
  const installed = [];
  for (const browser of browsers) {
    if (await isBrowserInstalled(browser)) {
      installed.push(browser);
    }
  }

  if (installed.length === 0) {
    console.log('No supported browsers detected. Let’s install one.');
    const { browserToInstall } = await inquirer.prompt([
      {
        type: 'list',
        name: 'browserToInstall',
        message: 'Select a browser to install:',
        choices: browsers,
      },
    ]);

    try {
      const installedPath = await installBrowser(browserToInstall);
      browserPaths[browserToInstall][os.platform()] = installedPath;
      installed.push(browserToInstall);
      console.log(`Successfully installed ${browserToInstall}.`);
    } catch (error) {
      if (error.message.includes('Homebrew is not installed')) {
        console.error(error.message);
        return [];
      }
      console.error(`Failed to install ${browserToInstall}: ${error.message}`);
      return [];
    }
  }

  return installed;
};

const launchBrowser = (browser, url = '', flags = []) => {
  const browserPath = getBrowserPath(browser);
  if (!browserPath) {
    console.error(`Browser path for ${browser} not found.`);
    return null;
  }

  DEBUG.verbose && console.log({flags, url, browser});

  const childProcess = spawn(browserPath, [...flags, url], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  childProcess.stdout.on('data', (data) => {
    DEBUG.showBrowser && console.log(`browser: ${data}`);
  });

  childProcess.stderr.on('data', (data) => {
    DEBUG.showBrowser && console.error(`browser: ${data}`);
  });

  childProcess.on('close', (code) => {
    console.log(`browser process exited with code ${code}`);
  });

  childProcess.unref();

  return childProcess;
};

const killBrowser = (browserProcess) => {
  if (!browserProcess) {
    console.error('No browser process to kill.');
    return;
  }

  browserProcess.kill();
  console.log('Browser process killed.');
};

const isSpecialUrl = (url) => /^chrome|vivaldi|brave|edge|chromium/.test(url);

// API facade for parity with ChromeLaunch
const launch = async (opts = {}) => {
  const {
    logLevel = 'silent',
    port,
    chromeFlags = [],
    userDataDir = false,
    startingUrl = '',
    ignoreDefaultFlags = true,
    fullAsk = false,
  } = opts;

  DEBUG.showBrowser && console.log({ opts, startingUrl });
  const installedBrowsers = await getInstalledBrowsers();
  if (installedBrowsers.length === 0) {
    console.error('No supported browsers are available.');
    return null;
  }

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'browser',
      message: 'Select a browser to launch:',
      choices: installedBrowsers,
    },
    ...(fullAsk
      ? [
          {
            type: 'input',
            name: 'url',
            message: 'Enter the URL to open (optional):',
          },
          {
            type: 'input',
            name: 'flags',
            message: 'Enter command line flags (optional, space-separated):',
          },
          {
            type: 'confirm',
            name: 'ignoreSignal',
            message: 'Ignore SIGINT signal (Ctrl+C) to keep the browser running?',
            default: false,
          },
        ]
      : []),
  ]);

  const { browser, url, flags: flagString, ignoreSignal = opts.ignoreSignal || true } = answers;
  const flagArray = flagString ? flagString.split(' ') : [];

  const flags = [
    ...flagArray,
    `--remote-debugging-port=${port}`,
    ...chromeFlags,
    userDataDir ? `--user-data-dir=${userDataDir}` : '',
    ignoreDefaultFlags ? '--no-default-browser-check' : '',
  ].filter(Boolean);

  console.log(`Launching browser with log level: ${logLevel}`);
  const browserExec = BrowserDef.find(def => def.name === browser).exec[process.platform];
  const browserProcess = launchBrowser(browser, startingUrl || url, flags);

  if (!ignoreSignal) {
    process.on('SIGINT', () => {
      console.log('\nReceived SIGINT. Killing browser process...');
      killBrowser(browserProcess);
      process.exit();
    });
  }

  return browserProcess;
};

// Helper
const run = async () => {
  const installedBrowsers = await getInstalledBrowsers();
  if (installedBrowsers.length === 0) {
    console.error('No supported browsers are available.');
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'browser',
      message: 'Select a browser to launch:',
      choices: installedBrowsers,
    },
    {
      type: 'input',
      name: 'url',
      message: 'Enter the URL to open (optional):',
    },
    {
      type: 'input',
      name: 'flags',
      message: 'Enter command line flags (optional, space-separated):',
    },
    {
      type: 'confirm',
      name: 'ignoreSignal',
      message: 'Ignore SIGINT signal (Ctrl+C) to keep the browser running?',
      default: false,
    },
  ]);

  const { browser, url, flags, ignoreSignal } = answers;
  const flagArray = flags ? flags.split(' ') : [];
  const browserProcess = launchBrowser(browser, url, flagArray);

  if (!ignoreSignal) {
    process.on('SIGINT', () => {
      console.log('\nReceived SIGINT. Killing browser process...');
      killBrowser(browserProcess);
      process.exit();
    });
  }
};

// CLI entry point
if (root.file === process.argv[1]) {
  run();
}

export default {
  getBrowserPath,
  isBrowserInstalled,
  getInstalledBrowsers,
  launchBrowser,
  killBrowser,
  isSpecialUrl,
  run,
  launch,
};
