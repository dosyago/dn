import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ChromeLauncher from './launcher.js';
import psList from '@667/ps-list';
import { DEBUG, sleep, NO_SANDBOX, GO_SECURE } from './common.js';
import { Archivist } from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const { server_port, mode, chrome_port } = args;
const execAsync = promisify(exec);

// Browser definitions with platform-specific executable and package names
const BROWSERS = [
  {
    name: 'Chrome',
    pattern: /^(chrome|google chrome|google-chrome)/i,
    cmdPattern: /[\/\\]chrome/i,
    exec: { win32: 'chrome.exe', darwin: 'Google Chrome', linux: 'google-chrome', freebsd: 'chrome' },
    package: { linux: 'google-chrome-stable', darwin: 'https://www.google.com/chrome/', win32: 'https://www.google.com/chrome/', freebsd: 'chrome' }
  },
  {
    name: 'Chromium',
    pattern: /^chromium/i,
    cmdPattern: /[\/\\]chromium/i,
    exec: { win32: 'chrome.exe', darwin: 'Chromium', linux: 'chromium-browser', freebsd: 'chromium' },
    package: { linux: 'chromium-browser', darwin: 'https://www.chromium.org/getting-involved/download-chromium/', win32: 'https://www.chromium.org/getting-involved/download-chromium/', freebsd: 'chromium' }
  },
  {
    name: 'Vivaldi',
    pattern: /^vivaldi/i,
    cmdPattern: /[\/\\]vivaldi/i,
    exec: { win32: 'vivaldi.exe', darwin: 'Vivaldi', linux: 'vivaldi', freebsd: 'vivaldi' },
    package: { linux: 'vivaldi-stable', darwin: 'https://vivaldi.com/download/', win32: 'https://vivaldi.com/download/', freebsd: 'vivaldi' }
  },
  {
    name: 'Brave',
    pattern: /^brave/i,
    cmdPattern: /[\/\\]brave/i,
    exec: { win32: 'brave.exe', darwin: 'Brave Browser', linux: 'brave', freebsd: 'brave' },
    package: { linux: 'brave-browser', darwin: 'https://brave.com/download/', win32: 'https://brave.com/download/', freebsd: 'brave' }
  },
  {
    name: 'Edge',
    pattern: /^(edge|msedge)/i,
    cmdPattern: /[\/\\](msedge|edge)/i,
    exec: { win32: 'msedge.exe', darwin: 'Microsoft Edge', linux: 'microsoft-edge', freebsd: 'edge' },
    package: { linux: 'microsoft-edge-stable', darwin: 'https://www.microsoft.com/edge', win32: 'https://www.microsoft.com/edge', freebsd: 'edge' }
  }
];

// Chrome launch options
const chromeFlags = [
  `--disk-cache-dir=${args.temp_browser_cache()}`,
  `--aggressive-cache-discard`,
  ...(!NO_SANDBOX ? [] : ['--no-sandbox']),
  ...(process.env.DK_HEADLESS ? ['--headless'] : [])
];
const LAUNCH_OPTS = {
  logLevel: DEBUG.verboseBrowser ? 'verbose' : 'silent',
  port: chrome_port,
  chromeFlags,
  userDataDir: false,
  startingUrl: `${GO_SECURE ? 'https' : 'http'}://localhost:${server_port}`,
  ignoreDefaultFlags: true
};

// Platform-specific kill commands
const KILL_ON = browser => ({
  win32: `taskkill /IM ${browser} /F`,
  darwin: `kill $(pgrep -i ${browser})`,
  freebsd: `pkill -15 ${browser}`,
  linux: `pkill -15 ${browser}`
});

let quitting;

// Start the application
start().catch(async err => {
  await cleanup('Startup error', err, { exit: true });
});

// Prompt user with inquirer
async function promptUser(question, options) {
  const choices = options.map((opt, i) => ({
    name: `${i + 1}. ${opt.text}`,
    value: opt.value
  }));
  const defaultChoice = options.find(opt => opt.default)?.value || options[0].value;

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: chalk.blue.bold(question),
      choices,
      default: defaultChoice
    }
  ]);

  return choice;
}

// Detect installed browsers
async function detectInstalledBrowsers() {
  const installed = [];
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  for (const browser of BROWSERS) {
    try {
      const execName = browser.exec[process.platform] || browser.name.toLowerCase();
      const cmd = process.platform === 'win32' ? `where ${execName}` : `command -v ${execName}`;
      await execAsync(cmd, { shell });
      installed.push(browser);
    } catch (e) {
      // Browser not installed, skip
    }
  }
  return installed;
}

// Check if a browser is connectable via RDP
async function checkIsConnectable(browser) {
  const hosts = ['localhost', '127.0.0.1', '::1'];
  for (const host of hosts) {
    try {
      const url = `http://${host}:${chrome_port}/json/version`;
      const response = await fetch(url, { timeout: 500 });
      if (response.status === 200) {
        const data = await response.json();
        if (data.Browser) {
          return true;
        }
      }
    } catch (e) {
      DEBUG.verboseSlow && console.warn(chalk.yellow(`RDP check failed for ${browser.name} on ${host}: ${e.message}`));
    }
  }
  return false;
}

// Detect browser status (running and connectable)
async function detectBrowsers() {
  const processes = await psList();
  DEBUG.showList && console.log(chalk.cyan({ processes }));

  const installed = await detectInstalledBrowsers();
  const browserStatus = await Promise.all(BROWSERS.map(async browser => {
    const proc = processes.find(({ name, cmd }) =>
      name?.match?.(browser.pattern) || cmd?.match?.(browser.cmdPattern)
    );
    const isRunning = !!proc;
    const isConnectable = isRunning && await checkIsConnectable(browser);
    const isInstalled = installed.some(b => b.name === browser.name);
    return { ...browser, isRunning, isConnectable, isInstalled, proc };
  }));

  const running = browserStatus.filter(b => b.isRunning);
  return { installed, running, all: browserStatus };
}

// Kill a browser process
async function killBrowser(browserName) {
  if (!(process.platform in KILL_ON(browserName))) {
    console.warn(chalk.yellow(`Platform ${process.platform} not supported for killing ${browserName}. Please close it manually.`));
    return;
  }

  try {
    console.log(chalk.cyan(`Shutting down ${browserName}...`));
    const { stderr } = await execAsync(KILL_ON(browserName)[process.platform], { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash' });
    if (stderr) {
      console.log(chalk.cyan(`No running ${browserName} found.`));
      DEBUG.verboseSlow && console.warn(chalk.yellow(`Error closing ${browserName}: ${stderr}`));
    } else {
      console.log(chalk.green(`${browserName} shut down.`));
      await sleep(1000);
    }
  } catch (e) {
    console.warn(chalk.yellow(`Error shutting down ${browserName}: ${e.message}`));
  }
}

// Clean up temporary cache
async function cleanTempCache() {
  const tempDir = args.temp_browser_cache();
  try {
    if (await fs.access(tempDir).then(() => true).catch(() => false)) {
      console.log(chalk.cyan(`Deleting temporary browser cache (${tempDir})...`));
      await fs.rm(tempDir, { recursive: true });
      console.log(chalk.green(`Deleted.`));
    }
  } catch (e) {
    console.warn(chalk.yellow(`Error deleting temporary cache: ${e.message}`));
  }
}

// Main startup function
async function start() {
  console.log(chalk.cyan(`Starting DownloadNet...`));
  let quitting = false;

  // Set up cleanup handlers
  const signals = [
    'error', 'unhandledRejection', 'uncaughtException', 'SIGHUP',
    'beforeExit', 'SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGBREAK', 'SIGABRT'
  ];
  for (const signal of signals) {
    process.on(signal, async (errOrCode) => {
      console.log('what', errOrCode, (new Error).stack);
      const reason = typeof errOrCode === 'string' ? errOrCode : `Received ${signal}`;
      const err = errOrCode instanceof Error ? errOrCode : null;
      await cleanup(reason, err, { exit: true });
    });
  }

  // Step 1: Detect browser status
  console.log(chalk.cyan(`Checking browsers...`));
  const { installed, running, all: browserStatus } = await detectBrowsers();
  const connectable = browserStatus.filter(b => b.isConnectable);

  // Step 2: Prompt user based on browser status
  console.log(chalk.blue.bold(`\nBrowser Status:`));
  console.log(chalk.cyan(`Installed: ${installed.map(b => b.name).join(', ') || 'None'}`));
  console.log(chalk.cyan(`Running: ${running.map(b => b.name).join(', ') || 'None'}`));
  console.log(chalk.cyan(`Connectable: ${connectable.map(b => b.name).join(', ') || 'None'}`));

  let action = null;
  if (browserStatus.length > 0) {
    const options = [
      ...connectable.map(b => ({
        text: `Use running ${b.name} (already open and connectable)`,
        value: { action: 'connect', browser: b },
        default: true
      })),
      ...running.map(b => ({
        text: `Relaunch ${b.name} (to enable remote debugging)`,
        value: { action: 'relaunch', browser: b }
      })),
      ...browserStatus.map(b => ({
        text: b.isInstalled
          ? `Launch ${b.name} (new instance)`
          : `Install and launch ${b.name} (requires installation)`,
        value: { action: b.isInstalled ? 'launch' : 'install', browser: b }
      })),
      { text: 'Exit', value: null }
    ];

    action = await promptUser(
      'Select a browser to use for archiving (remote debugging required):',
      options
    );
  } else {
    console.log(chalk.red('No supported browsers detected. Please install a compatible browser.'));
    await cleanup('No browsers available', null, { exit: true });
    return;
  }

  if (!action) {
    console.log(chalk.cyan('Exiting...'));
    await cleanup('User chose to exit', null, { exit: true });
    return;
  }

  // Step 3: Handle user choice
  let browser;
  if (action.action === 'connect') {
    console.log(chalk.cyan(`Connecting to running ${action.browser.name}...`));
    browser = action.browser;
  } else if (action.action === 'relaunch') {
    await killBrowser(action.browser.name);
    action = { action: 'launch', browser: action.browser };
  } else if (action.action === 'install') {
    console.log(chalk.red(`\n${action.browser.name} is not installed. Please install it to proceed.`));
    const pkg = action.browser.package[process.platform];
    if (pkg.startsWith('http')) {
      console.log(chalk.cyan(`Download and install from: ${pkg}`));
    } else if (process.platform === 'linux') {
      console.log(chalk.cyan(`For example, on Ubuntu/Debian, run: sudo apt-get install ${pkg}`));
    } else if (process.platform === 'freebsd') {
      console.log(chalk.cyan(`For example, run: sudo pkg install ${pkg}`));
    } else {
      console.log(chalk.cyan(`Visit the browser's website to download and install.`));
    }
    await cleanup(`${action.browser.name} not installed`, null, { exit: true });
    return;
  }

  // Step 4: Clean temporary cache
  await cleanTempCache();

  // Step 5: Start library server
  console.log(chalk.cyan(`Launching library server...`));
  await LibraryServer.start({ server_port });
  console.log(chalk.green(`Library server started.`));

  // Step 6: Launch browser if needed
  if (action.action === 'launch') {
    console.log(chalk.cyan(`Launching ${action.browser.name}...`));
    try {
      browser = await ChromeLauncher.launch(LAUNCH_OPTS);
      browser.on('exit', async err => {
        console.log(chalk.cyan('Browser shutting down. Exiting...'));
        await cleanup('Browser exited', err, { exit: true });
      });
      browser.on('spawn', () => {
        if (process.env.DK_HEADLESS) {
          console.info(chalk.cyan(`
            ============= INFO ==============
            Browser running in headless mode. Attach a display (e.g., BrowserBox) to interact.
            ==================================
          `));
        }
      });
      console.log(chalk.green(`Browser started.`));
      await sleep(2000);
    } catch (e) {
      console.error(chalk.red(`Failed to launch browser: ${e.message}`));
      DEBUG.verboseSlow && console.info(chalk.yellow('Chrome launch error:', e));
      await cleanup('Browser launch failed', e, { exit: true });
      return;
    }
  }

  if (quitting) return;

  // Step 7: Start archivist
  console.log(chalk.cyan(`Connecting archivist to browser...`));
  await Archivist.collect({ chrome_port, mode });
  console.log(chalk.green(`System ready.`));
}

// Cleanup function
async function cleanup(reason, err, { exit = false } = {}) {
  if (quitting) {
    console.log(chalk.cyan(`Cleanup already called, skipping...`));
    return;
  }
  quitting = true;

  console.log(chalk.cyan(`Shutting down...`));
  DEBUG.verbose && console.log(chalk.yellow(`Cleanup reason: ${reason}`, err));
  console.log({quitting,exit,reason,err}, (new Error).stack);

  Archivist.shutdown();
  LibraryServer.stop();

  if (exit) {
    console.log(chalk.cyan(`Exiting in 3 seconds...`));
    await sleep(3000);
    process.exit(0);
  }
}
