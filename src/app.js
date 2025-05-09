import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import { stdin as input, stdout as output } from 'process';

import ChromeLauncher from './launcher.js';
import psList from '@667/ps-list';

import { DEBUG, sleep, NO_SANDBOX, GO_SECURE } from './common.js';
import { Archivist } from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const { server_port, mode, chrome_port } = args;
const execAsync = promisify(exec);

// Browser definitions
const BROWSERS = [
  { name: 'Chrome', pattern: /^(chrome|google chrome|google-chrome)/i, cmdPattern: /[\/\\]chrome/i },
  { name: 'Chromium', pattern: /^chromium/i, cmdPattern: /[\/\\]chromium/i },
  { name: 'Vivaldi', pattern: /^vivaldi/i, cmdPattern: /[\/\\]vivaldi/i },
  { name: 'Brave', pattern: /^brave/i, cmdPattern: /[\/\\]brave/i },
  { name: 'Edge', pattern: /^(edge|msedge)/i, cmdPattern: /[\/\\](msedge|edge)/i }
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
const KILL_ON = (browser) => ({
  win32: `taskkill /IM ${browser} /F`,
  darwin: `kill $(pgrep -i ${browser})`,
  freebsd: `pkill -15 ${browser}`,
  linux: `pkill -15 ${browser}`
});

// Prompt user with options
async function promptUser(question, options) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(`\n${question}`);
    options.forEach((opt, i) => console.log(`${i + 1}. ${opt.text}`));
    const answer = await new Promise(resolve => rl.question('Enter your choice (number, or Enter for default): ', resolve));
    const choice = parseInt(answer) - 1;
    return options[choice]?.value || options.find(opt => opt.default)?.value || null;
  } finally {
    rl.close();
  }
}

// Detect browser status (running and connectable)
async function detectBrowsers() {
  const processes = await psList();
  DEBUG.showList && console.log({ processes });

  const browserStatus = BROWSERS.map(browser => {
    const proc = processes.find(({ name, cmd }) =>
      name?.match?.(browser.pattern) || cmd?.match?.(browser.cmdPattern)
    );
    const isRunning = !!proc;
    const isConnectable = isRunning && proc.cmd.includes(`--remote-debugging-port=${chrome_port}`);
    return { ...browser, isRunning, isConnectable, proc };
  });

  // Simulate installed browsers (all defined browsers for now)
  const installed = browserStatus; // In reality, check with `which` or `where`
  const running = browserStatus.filter(b => b.isRunning);
  return { installed, running };
}

// Kill a browser process
async function killBrowser(browserName) {
  if (!(process.platform in KILL_ON(browserName))) {
    console.warn(`Platform ${process.platform} not supported for killing ${browserName}. Please close it manually.`);
    return;
  }

  try {
    console.log(`Shutting down ${browserName}...`);
    const { stderr } = await execAsync(KILL_ON(browserName)[process.platform]);
    if (stderr) {
      console.log(`No running ${browserName} found.`);
      DEBUG.verboseSlow && console.warn(`Error closing ${browserName}: ${stderr}`);
    } else {
      console.log(`${browserName} shut down.`);
      await sleep(1000);
    }
  } catch (e) {
    console.warn(`Error shutting down ${browserName}: ${e.message}`);
  }
}

// Clean up temporary cache
async function cleanTempCache() {
  const tempDir = args.temp_browser_cache();
  try {
    if (await fs.access(tempDir).then(() => true).catch(() => false)) {
      console.log(`Deleting temporary browser cache (${tempDir})...`);
      await fs.rm(tempDir, { recursive: true });
      console.log(`Deleted.`);
    }
  } catch (e) {
    console.warn(`Error deleting temporary cache: ${e.message}`);
  }
}

// Main startup function
async function start() {
  console.log(`Starting DownloadNet...`);
  let quitting = false;

  // Set up cleanup handlers
  for (const signal of ['error', 'unhandledRejection', 'uncaughtException', 'SIGHUP']) {
    process.on(signal, async (err) => await cleanup(err.message || signal, err));
  }
  for (const signal of ['beforeExit', 'SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGBREAK', 'SIGABRT']) {
    process.on(signal, async (code) => await cleanup(`Received ${signal}`, null, { exit: true }));
  }

  // Step 1: Detect browser status
  console.log(`Checking browsers...`);
  const { installed, running } = await detectBrowsers();
  const connectable = running.filter(b => b.isConnectable);

  // Step 2: Prompt user based on browser status
  console.log(`\n**Browser Status:**`);
  console.log(`Installed: ${installed.map(b => b.name).join(', ') || 'None'}`);
  console.log(`Running: ${running.map(b => b.name).join(', ') || 'None'}`);
  console.log(`Connectable: ${connectable.map(b => b.name).join(', ') || 'None'}`);

  let browserAction = null;
  if (connectable.length > 0 || running.length > 0 || installed.length > 0) {
    const options = [];
    connectable.forEach(b =>
      options.push({
        text: `Use running ${b.name} (already open and connectable)`,
        value: { action: 'connect', browser: b },
        default: true
      })
    );
    running.forEach(b =>
      options.push({
        text: `Relaunch ${b.name} (to enable remote debugging)`,
        value: { action: 'relaunch', browser: b }
      })
    );
    installed.forEach(b =>
      options.push({
        text: `Launch ${b.name} (new instance)`,
        value: { action: 'launch', browser: b }
      })
    );
    options.push({ text: 'Exit', value: null });

    browserAction = await promptUser(
      'Select a browser to use for archiving (remote debugging required):',
      options
    );
  } else {
    console.log('No supported browsers detected. Please install Chrome or a compatible browser.');
    await cleanup('No browsers available', null, { exit: true });
    return;
  }

  if (!browserAction) {
    console.log('Exiting...');
    await cleanup('User chose to exit', null, { exit: true });
    return;
  }

  // Step 3: Handle user choice
  let browser;
  if (browserAction.action === 'connect') {
    console.log(`Connecting to running ${browserAction.browser.name}...`);
    browser = browserAction.browser;
    // No need to launch; browser is already running and connectable
  } else if (browserAction.action === 'relaunch') {
    await killBrowser(browserAction.browser.name);
    browserAction = { action: 'launch', browser: browserAction.browser };
  }

  // Step 4: Clean temporary cache
  await cleanTempCache();

  // Step 5: Start library server
  console.log(`Launching library server...`);
  await LibraryServer.start({ server_port });
  console.log(`Library server started.`);

  // Step 6: Launch browser if needed
  if (browserAction.action === 'launch') {
    console.log(`Launching ${browserAction.browser.name}...`);
    try {
      browser = await ChromeLauncher.launch(LAUNCH_OPTS);
      browser.on('exit', async err => {
        console.log('Browser shutting down. Exiting...');
        await cleanup('Browser exited', err, { exit: true });
      });
      browser.on('spawn', () => {
        if (process.env.DK_HEADLESS) {
          console.info(`
            ============= INFO ==============
            Browser running in headless mode. Attach a display (e.g., BrowserBox) to interact.
            ==================================
          `);
        }
      });
      console.log(`Browser started.`);
      await sleep(2000);
    } catch (e) {
      console.error(`Failed to launch browser: ${e.message}`);
      DEBUG.verboseSlow && console.info('Chrome launch error:', e);
      await cleanup('Browser launch failed', e, { exit: true });
      return;
    }
  }

  if (quitting) return;

  // Step 7: Start archivist
  console.log(`Connecting archivist to browser...`);
  await Archivist.collect({ chrome_port, mode });
  console.log(`System ready.`);
}

// Cleanup function
async function cleanup(reason, err, { exit = false } = {}) {
  if (quitting) {
    console.log(`Cleanup already called, skipping...`);
    return;
  }
  quitting = true;

  console.log(`Shutting down...`);
  DEBUG.verbose && console.log(`Cleanup reason: ${reason}`, err);

  Archivist.shutdown();
  LibraryServer.stop();

  if (exit) {
    console.log(`Exiting in 3 seconds...`);
    await sleep(3000);
    process.exit(0);
  }
}

// Start the application
start().catch(async err => {
  await cleanup('Startup error', err, { exit: true });
});
