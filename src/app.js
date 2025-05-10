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

// Browser definitions with platform-specific executable, package names, and paths
const BROWSERS = [
  {
    name: 'Chrome',
    pattern: /^(chrome|google chrome|google-chrome)/i,
    cmdPattern: /[\/\\]chrome/i,
    exec: { win32: 'chrome.exe', darwin: 'Google Chrome', linux: 'google-chrome', freebsd: 'chrome' },
    package: { linux: 'google-chrome-stable', darwin: 'https://www.google.com/chrome/', win32: 'https://www.google.com/chrome/', freebsd: 'chrome' },
    paths: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/google-chrome',
      '/usr/local/bin/google-chrome'
    ]
  },
  {
    name: 'Chromium',
    pattern: /^chromium/i,
    cmdPattern: /[\/\\]chromium/i,
    exec: { win32: 'chrome.exe', darwin: 'Chromium', linux: 'chromium-browser', freebsd: 'chromium' },
    package: { linux: 'chromium-browser', darwin: 'https://www.chromium.org/getting-involved/download-chromium/', win32: 'https://www.chromium.org/getting-involved/download-chromium/', freebsd: 'chromium' },
    paths: [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      '/usr/bin/chromium-browser',
      '/usr/local/bin/chromium-browser'
    ]
  },
  {
    name: 'Vivaldi',
    pattern: /^vivaldi/i,
    cmdPattern: /[\/\\]vivaldi/i,
    exec: { win32: 'vivaldi.exe', darwin: 'Vivaldi', linux: 'vivaldi', freebsd: 'vivaldi' },
    package: { linux: 'vivaldi-stable', darwin: 'https://vivaldi.com/download/', win32: 'https://vivaldi.com/download/', freebsd: 'vivaldi' },
    paths: [
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
      'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
      '/usr/bin/vivaldi',
      '/usr/local/bin/vivaldi'
    ]
  },
  {
    name: 'Brave',
    pattern: /^brave/i,
    cmdPattern: /[\/\\]brave/i,
    exec: { win32: 'brave.exe', darwin: 'Brave Browser', linux: 'brave', freebsd: 'brave' },
    package: { linux: 'brave-browser', darwin: 'https://brave.com/download/', win32: 'https://brave.com/download/', freebsd: 'brave' },
    paths: [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '/usr/bin/brave',
      '/usr/local/bin/brave'
    ]
  },
  {
    name: 'Edge',
    pattern: /^(microsoft edge|microsoft\-edge|msedge)/i,
    cmdPattern: /[\/\\](msedge|microsoft edge|microsoft\-edge)/i,
    exec: { win32: 'msedge.exe', darwin: 'Microsoft Edge', linux: 'microsoft-edge', freebsd: 'edge' },
    package: { linux: 'microsoft-edge-stable', darwin: 'https://www.microsoft.com/edge', win32: 'https://www.microsoft.com/edge', freebsd: 'edge' },
    paths: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/microsoft-edge',
      '/usr/local/bin/microsoft-edge'
    ]
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
const KILL_ON = browserName => ({ // browserName is a string like "Chrome" or "vivaldi.exe"
  win32: `taskkill /IM ${browserName} /F`, // Assumes browserName matches executable or is handled by IM
  darwin: `kill $(pgrep -i "${browserName}")`, // pgrep -i for case-insensitive match
  freebsd: `pkill -15 "${browserName}"`,
  linux: `pkill -15 "${browserName}"`
});

let quitting = false;

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
  // Set default choice: first option with 'default: true', or first option overall
  const defaultChoice = options.find(opt => opt.default)?.value || (choices.length > 0 ? choices[0].value : null);

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
    let isInstalled = false;
    const execName = browser.exec[process.platform] || browser.name.toLowerCase();

    // Check command -v or where
    try {
      const cmd = process.platform === 'win32' ? `where ${execName}` : `command -v ${execName}`;
      await execAsync(cmd, { shell });
      isInstalled = true;
    } catch (e) {
      // Not in PATH, continue to path check
    }

    // Check predefined paths
    if (!isInstalled) {
      for (const path of browser.paths) {
        try {
          await fs.access(path);
          isInstalled = true;
          break;
        } catch (e) {
          // Path doesn't exist, continue
        }
      }
    }

    if (isInstalled) {
      installed.push(browser);
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
      DEBUG.verbose && console.log(`Testing`, url);
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if ( data.Browser ) {
          const browserShortName = data.Browser.split(/\//)[0];
          if ( browserShortName.slice(0,2) == browser.name.slice(0,2) ) return true;
        } 
      }
    } catch (e) {
      DEBUG.verboseSlow && console.warn(chalk.yellow(`RDP check failed for ${browser.name} on ${host}:${chrome_port}: ${e.message}`));
    }
  }
  return false;
}

// Detect browser status (running and connectable)
async function detectBrowsers() {
  const processes = await psList();
  (DEBUG.verbose || DEBUG.showList) && console.log(JSON.stringify({ processes },null,2));

  const installedBrowsers = await detectInstalledBrowsers();
  const browserStatus = await Promise.all(BROWSERS.map(async browserDef => {
    const proc = processes.find(({ name, cmd }) =>
      name?.match?.(browserDef.pattern) || cmd?.match?.(browserDef.cmdPattern)
    );
    const isRunning = !!proc;
    // Only check connectable if it's the type of browser we're looking for and it's running
    const isConnectable = isRunning && await checkIsConnectable(browserDef);
    const isInstalled = installedBrowsers.some(b => b.name === browserDef.name);
    return { ...browserDef, isRunning, isConnectable, isInstalled, proc };
  }));

  const running = browserStatus.filter(b => b.isRunning);
  const installed = browserStatus.filter(b => b.isInstalled); // More accurate installed list based on browserStatus
  return { installed, running, all: browserStatus };
}

// Kill a browser process
async function killBrowser(browserName) { // Expects browser friendly name e.g. "Chrome"
  const browserDefinition = BROWSERS.find(b => b.name === browserName);
  const execToKill = browserDefinition?.exec[process.platform] || browserName; // Use specific exec name if available

  if (!(process.platform in KILL_ON(execToKill))) {
    console.warn(chalk.yellow(`Platform ${process.platform} not supported for killing ${browserName}. Please close it manually.`));
    return;
  }

  try {
    console.log(chalk.cyan(`Attempting to shut down ${browserName}...`));
    const killCommand = KILL_ON(execToKill)[process.platform];
    const { stderr } = await execAsync(killCommand, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash' });
    if (stderr && !stderr.toLowerCase().includes('no tasks running') && !stderr.toLowerCase().includes('not found')) {
      // Some errors (like "process not found") are expected if it already closed, others might be issues.
      DEBUG.verboseSlow && console.warn(chalk.yellow(`Error closing ${browserName}: ${stderr.trim()}`));
      console.log(chalk.cyan(`${browserName} might not have been running or could not be closed.`));
    } else if (!stderr || stderr.toLowerCase().includes('no tasks running') || stderr.toLowerCase().includes('not found')) {
      console.log(chalk.green(`${browserName} shut down or was not running.`));
    } else {
      console.log(chalk.green(`${browserName} shut down command issued.`));
    }
    await sleep(1000); // Give some time for the process to terminate
  } catch (e) {
    // Catch errors where the process might not be found (which is okay if we're trying to kill it)
    if (e.message.toLowerCase().includes('process not found') || e.message.toLowerCase().includes('no matching processes')) {
        console.log(chalk.cyan(`${browserName} was not found or already closed.`));
    } else {
        console.warn(chalk.yellow(`Error in kill browser for ${browserName}: ${e.message}`));
    }
  }
}

// Clean up temporary cache
async function cleanTempCache() {
  const tempDir = args.temp_browser_cache();
  try {
    if (await fs.access(tempDir).then(() => true).catch(() => false)) {
      console.log(chalk.cyan(`Removing 22120's existing temporary browser cache (${tempDir})...`));
      await fs.rm(tempDir, { recursive: true });
      console.log(chalk.green(`Deleted.`));
    }
  } catch (e) {
    console.warn(chalk.yellow(`Error deleting temporary cache: ${e.message}`));
  }
}

// Main startup function
async function start() {
  console.log(chalk.cyan(`Running in node...`));

  // Set up cleanup handlers
  const signals = ['error', 'unhandledRejection', 'uncaughtException', 'SIGHUP', 'beforeExit'];
  for (const signal of signals) {
    process.on(signal, async (err) => await cleanup(err?.message || signal, err));
  }
  const exitSignals = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGBREAK', 'SIGABRT'];
  for (const signal of exitSignals) {
    process.on(signal, async (code) => await cleanup(code, 'signal', { exit: true }));
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
  // Build options list
  const menuOptions = [];

  // Option: Use running & connectable
  connectable.forEach(b => {
    menuOptions.push({
      text: `Use running ${b.name} (already open and connectable)`,
      value: { action: 'connect', browser: b },
      default: true // Make this the default if available
    });
  });

  // Option: Relaunch running (to enable remote debugging)
  running.forEach(b => {
    // Only add "Relaunch" if not already offered as "Connect" OR always offer both?
    // Original code implies offering both, which gives user choice.
    menuOptions.push({
      text: `Relaunch ${b.name} (to enable archiving)`,
      value: { action: 'relaunch', browser: b }
    });
  });

  // Option: Launch new instance (if installed but not running) OR Install and launch
  browserStatus.forEach(b => {
    if (b.isInstalled) {
      // Offer "Launch new instance" ONLY if installed AND NOT currently running.
      // If it's running, "Relaunch" is the more appropriate option.
      // If it's running AND connectable, "Use running" is the primary option.
      if (!b.isRunning) {
        menuOptions.push({
          text: `Launch ${b.name} (new instance)`,
          value: { action: 'launch', browser: b }
        });
      }
    } else {
      // Not installed, offer "Install and launch"
      menuOptions.push({
        text: `Install and launch ${b.name} (requires installation)`,
        value: { action: 'install', browser: b }
      });
    }
  });
  
  // Add new "Shut down all" option
  if (running.length > 0) { // Only show if there are browsers to shut down
    menuOptions.push({
      text: 'Shut down all browser processes and exit',
      value: { action: 'shutdown_all_and_exit' }
    });
  }

  // Add "Exit" option
  menuOptions.push({ text: 'Exit', value: { action: 'exit_only' } }); // Use an object for consistency

  // Deduplicate options based on their `value.action` and `value.browser.name` to avoid redundant entries
  const uniqueMenuOptions = [];
  const seenValues = new Set();
  for (const opt of menuOptions) {
      let key;
      if (opt.value && opt.value.browser && opt.value.browser.name) {
          key = `${opt.value.action}_${opt.value.browser.name}`;
      } else if (opt.value && opt.value.action) {
          key = opt.value.action;
      } else {
          key = opt.text; // Fallback for null value or unique text-based options
      }

      if (!seenValues.has(key)) {
          uniqueMenuOptions.push(opt);
          seenValues.add(key);
      } else if (opt.default) { // Prioritize default option if duplicate key
          const existingIndex = uniqueMenuOptions.findIndex(uo => uo.value && uo.value.browser && uo.value.browser.name ? `${uo.value.action}_${uo.value.browser.name}` === key : (uo.value && uo.value.action ? uo.value.action === key : uo.text === key));
          if (existingIndex !== -1) {
              uniqueMenuOptions[existingIndex] = opt; // Replace with the one marked default
          }
      }
  }


  if (uniqueMenuOptions.filter(opt => opt.value && opt.value.action !== 'exit_only' && opt.value.action !== 'shutdown_all_and_exit').length > 0 ||
      uniqueMenuOptions.some(opt => opt.value && opt.value.action === 'shutdown_all_and_exit')) { // Check if any actionable options exist (besides plain exit)
    action = await promptUser(
      'Select a browser to use for archiving:',
      uniqueMenuOptions
    );
  } else {
    console.log(chalk.red('No supported browsers detected or actionable options available. Please install a compatible browser.'));
    await cleanup('No browsers available or actionable', null, { exit: true });
    return;
  }

  if (!action || action.action === 'exit_only') { // Handles null (if Exit value was null) or explicit exit_only
    console.log(chalk.cyan('Exiting as requested.'));
    await cleanup('User chose to exit', null, { exit: true });
    return;
  }

  // Handle new action: Shut down all and exit
  if (action.action === 'shutdown_all_and_exit') {
    console.log(chalk.cyan('Attempting to shut down all detected running browser processes...'));
    if (running.length > 0) {
      for (const browserToKill of running) {
        // killBrowser expects the browser name (e.g., "Chrome")
        await killBrowser(browserToKill.name);
      }
      console.log(chalk.green('All detected running browser processes have been issued a shutdown command.'));
    } else {
      // This case should ideally not be reached if the option is only shown when running.length > 0
      console.log(chalk.cyan('No running browser processes were detected to shut down.'));
    }
    await cleanup('User chose to shut down all browsers and exit', null, { exit: true });
    return;
  }

  // Step 3: Handle user choice (connect, relaunch, install, launch)
  let browserToUse = action.browser; // Renamed to avoid conflict with 'browser' from ChromeLauncher

  if (action.action === 'connect') {
    console.log(chalk.cyan(`\n\n [ATTENTION!] Seems ${browserToUse.name} is already open.\n\n`));
    console.log(chalk.cyan(`Connecting to running ${browserToUse.name}...`));
    // browserToUse is already set
  } else if (action.action === 'relaunch') {
    console.log(chalk.cyan(`\n\n [ATTENTION!] Seems ${browserToUse.name} is already open.\n\n`));
    console.log(chalk.cyan(`Relaunching ${browserToUse.name} to ensure archiving is enabled...`));
    // killBrowser expects the browser name (e.g., "Chrome")
    await killBrowser(browserToUse.name);
    // After killing, we proceed to launch it as a new instance
    action.action = 'launch'; // Change action to 'launch' for the next step
  } else if (action.action === 'install') {
    console.log(chalk.red(`\n${browserToUse.name} is not installed. Please install it to proceed.`));
    const pkg = browserToUse.package[process.platform];
    if (pkg.startsWith('http')) {
      console.log(chalk.cyan(`Download and install from: ${pkg}`));
    } else if (process.platform === 'linux') {
      console.log(chalk.cyan(`For example, on Ubuntu/Debian, run: sudo apt-get install ${pkg}`));
    } else if (process.platform === 'freebsd') {
      console.log(chalk.cyan(`For example, run: sudo pkg install ${pkg}`));
    } else {
      console.log(chalk.cyan(`Visit the browser's website to download and install.`));
    }
    await cleanup(`${browserToUse.name} not installed`, null, { exit: true });
    return;
  }

  // Step 4: Clean temporary cache (only if we are proceeding to launch/connect)
  await cleanTempCache();

  // Step 5: Start library server
  console.log(chalk.cyan(`Launching library server...`));
  await LibraryServer.start({ server_port });
  console.log(chalk.green(`Library server started.`));

  // Step 6: Launch browser if needed (action 'launch' or 'relaunch' becomes 'launch')
  let launchedBrowserInstance = null; // To store the browser instance from ChromeLauncher
  if (action.action === 'launch') {
    console.log(chalk.cyan(`Launching ${browserToUse.name}...`));
    try {
      // LAUNCH_OPTS needs to be configured for the specific browser if necessary,
      // though ChromeLauncher is generic enough for most Chromium-based browsers.
      // If browserToUse.exec[process.platform] is available, it could be used for `chromePath`.
      const launchOptions = { ...LAUNCH_OPTS };
      const specificPath = browserToUse.paths.find(async p => await fs.access(p).then(() => true).catch(() => false));
      if (specificPath) {
        launchOptions.chromePath = specificPath;
      } else {
        // Fallback to executable name if no specific path found (ChromeLauncher might find it in PATH)
        launchOptions.chromePath = browserToUse.exec[process.platform];
      }
      
      launchedBrowserInstance = await ChromeLauncher.launch(launchOptions);
      launchedBrowserInstance.on('exit', async (codeOrError) => { // Changed err to codeOrError
        const message = typeof codeOrError === 'number' ? `Browser exited with code ${codeOrError}` : 'Browser exited';
        console.log(chalk.cyan(`Browser (${browserToUse.name}) shutting down. Will exit...`));
        if (!quitting) {
          console.info(chalk.cyan(`
            ===========INFO===========
            Looks like this shutdown happened pretty quickly. Could be because you are running from a terminal without a display?
            In that case you'll need to connect BrowserBox and run your DownloadNet/DiskerNet/Archivist browser with the headless flag by specifying the environment variable

                "export DK_HEADLESS=true"

            And also ensure you download BrowserBox and set it up correctly to attach to this headless browser.
            ==========FIN==============
          `));
        }
        await cleanup(message, typeof codeOrError !== 'number' ? codeOrError : null, { exit: true });
      });
      launchedBrowserInstance.on('spawn', () => {
        if (process.env.DK_HEADLESS) {
          console.info(chalk.cyan(`
            ============= INFO ==============
            Your browser (${browserToUse.name}) is running in headless mode so you need to attach a display (like BrowserBox) to it, if you want to interact with it normally.
            ==================================
          `));
        }
      });
      console.log(chalk.green(`${browserToUse.name} started.`));
      console.log(chalk.cyan(`Waiting 2 seconds...`));
      await sleep(2000);
    } catch (e) {
      console.error(chalk.red(`Could not launch ${browserToUse.name}: ${e.message}`));
      DEBUG.verboseSlow && console.info(chalk.yellow('Chrome launch error:', e));
      await cleanup('Browser launch failed', e, { exit: true });
      return;
    }
  } else if (action.action === 'connect') {
    // If connecting, we assume the browserToUse.name is sufficient for Archivist.collect
    // and that it's already running with the correct remote debugging port.
    console.log(chalk.cyan(`Proceeding with already running and connectable ${browserToUse.name}.`));
  }


  if (quitting) return;

  // Step 7: Start archivist
  console.log(chalk.cyan(`Launching archivist and connecting to browser...`));
  // Archivist.collect expects chrome_port, which is fine.
  // It internally uses this port to connect, regardless of how the browser was started or connected to.
  await Archivist.collect({ chrome_port, mode });
  console.log(chalk.green(`System ready.`));
}

// Cleanup function
async function cleanup(reason, err, { exit = false } = {}) {
  if (quitting && exit) { // Allow multiple calls if not exiting, but only one full exit sequence
    console.log(chalk.cyan(`Cleanup already in progress for exit. Not running again.`));
    return;
  }
  console.log(chalk.cyan(`Shutting down everything...`));
  DEBUG.verbose && console.log(chalk.yellow(`Cleanup called on reason: ${reason}`, err instanceof Error ? err.stack : err));


  if (exit) quitting = true; // Set quitting to true mainly when an exit is imminent

  Archivist.shutdown();
  LibraryServer.stop();
  // Note: ChromeLauncher doesn't have a static .killAll() or similar.
  // Individual launched instances are killed via their .kill() method,
  // or the 'exit' event handler on the instance.
  // If a browser was launched by this script, its 'exit' handler calls cleanup.
  // If we are exiting due to "shutdown_all_and_exit", browsers were killed before this.

  if (exit) {
    console.log(chalk.cyan(`Take a breath. Everything's done. DownloadNet is exiting in 3 seconds...`));
    await sleep(3000);
    // quitting = false; // Not strictly necessary before process.exit
    process.exit(err instanceof Error ? 1 : 0); // Exit with error code if err is an Error
  }
}
