// app.js
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import inquirer from 'inquirer';
import chalk from 'chalk';
// import ChromeLauncher from './launcher.js'; // OLD
import BrowserLauncher from './launcher.js'; // NEW - Renamed for clarity
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
    // For psList matching, use a pattern that matches the process name or command line.
    // For launching, we'll find the specific executable.
    psPattern: /chrome$/i, // Matches 'chrome' or 'google-chrome' at the end of a path/name
    executables: { // Platform-specific executable names (for `where` or `command -v`)
        win32: 'chrome.exe',
        darwin: 'Google Chrome', // Application name for `open -a` or finding in /Applications
        linux: 'google-chrome',
        freebsd: 'chrome'
    },
    // For direct launch if found via these paths
    defaultPaths: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/google-chrome',
      '/usr/local/bin/google-chrome'
    ],
    // For RDP check, what does data.Browser typically start with?
    rdpBrowserName: /Chrome/i,
    // For user display and installation guidance
    packageName: { linux: 'google-chrome-stable', darwin: 'https://www.google.com/chrome/', win32: 'https://www.google.com/chrome/', freebsd: 'chrome' },
  },
  {
    name: 'Chromium',
    psPattern: /chromium(-browser)?$/i,
    executables: {
        win32: 'chromium.exe', // Often chrome.exe if it's a Chromium build
        darwin: 'Chromium',
        linux: 'chromium-browser', // or just 'chromium'
        freebsd: 'chromium'
    },
    defaultPaths: [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      'C:\\Program Files\\Chromium\\Application\\chrome.exe', // Some builds use chrome.exe
      'C:\\Program Files\\Chromium\\Application\\chromium.exe',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/local/bin/chromium-browser',
      '/usr/local/bin/chromium'
    ],
    rdpBrowserName: /Chromium/i,
    packageName: { linux: 'chromium-browser', darwin: 'https://www.chromium.org/getting-involved/download-chromium/', win32: 'https://www.chromium.org/getting-involved/download-chromium/', freebsd: 'chromium' },
  },
  {
    name: 'Vivaldi',
    psPattern: /vivaldi$/i,
    executables: { win32: 'vivaldi.exe', darwin: 'Vivaldi', linux: 'vivaldi', freebsd: 'vivaldi' },
    defaultPaths: [
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
      'C:\\Program Files\\Vivaldi\\Application\\vivaldi.exe',
      '/usr/bin/vivaldi',
      '/usr/local/bin/vivaldi'
    ],
    rdpBrowserName: /Vivaldi/i,
    packageName: { linux: 'vivaldi-stable', darwin: 'https://vivaldi.com/download/', win32: 'https://vivaldi.com/download/', freebsd: 'vivaldi' },
  },
  {
    name: 'Brave',
    psPattern: /brave(-browser)?$/i,
    executables: { win32: 'brave.exe', darwin: 'Brave Browser', linux: 'brave-browser', freebsd: 'brave' },
    defaultPaths: [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '/usr/bin/brave-browser',
      '/usr/local/bin/brave-browser'
    ],
    rdpBrowserName: /Brave/i,
    packageName: { linux: 'brave-browser', darwin: 'https://brave.com/download/', win32: 'https://brave.com/download/', freebsd: 'brave' },
  },
  {
    name: 'Edge',
    psPattern: /(msedge|microsoft-edge)$/i,
    executables: { win32: 'msedge.exe', darwin: 'Microsoft Edge', linux: 'microsoft-edge', freebsd: 'edge' },
    defaultPaths: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/microsoft-edge',
      '/usr/local/bin/microsoft-edge'
    ],
    rdpBrowserName: /Edg/i,
    packageName: { linux: 'microsoft-edge-stable', darwin: 'https://www.microsoft.com/edge', win32: 'https://www.microsoft.com/edge', freebsd: 'edge' },
  }
];


// Base Chrome launch flags
const BASE_CHROME_FLAGS = [
  `--remote-debugging-port=${chrome_port}`,
  `--disk-cache-dir=${args.temp_browser_cache()}`,
  `--aggressive-cache-discard`,
  // '--no-first-run', // Often useful
  // '--no-default-browser-check', // Often useful
  // '--disable-features=TranslateUI', // Example: disable a feature
  // '--disable-default-apps',
  // '--disable-component-update',
  // '--disable-background-networking',
  // '--disable-sync',
  // '--metrics-recording-only',
  // '--disable-breakpad', // Disables crash reporting
];
if (NO_SANDBOX) {
  BASE_CHROME_FLAGS.push('--no-sandbox');
  // On Linux, --no-sandbox often requires --disable-setuid-sandbox as well,
  // or running as root (which is not recommended for browsers).
  // if (process.platform === 'linux') BASE_CHROME_FLAGS.push('--disable-setuid-sandbox');
}
if (process.env.DK_HEADLESS) {
  BASE_CHROME_FLAGS.push('--headless=new'); // Modern headless
  // BASE_CHROME_FLAGS.push('--disable-gpu'); // Often needed with headless
  // BASE_CHROME_FLAGS.push('--window-size=1920,1080'); // Example size
}

// Platform-specific kill commands
// Uses the executable name for killing, which should be more reliable
const KILL_ON = browserDefinition => {
    const execName = browserDefinition.executables[process.platform];
    if (!execName) return {}; // Should not happen if browserDefinition is valid
    return {
        win32: `taskkill /IM ${execName} /F`,
        darwin: `pkill -if "${execName}"`, // pkill -if is case-insensitive and matches full path
        freebsd: `pkill -15 -f "${execName}"`, // -f to match against full command line
        linux: `pkill -15 -f "${execName}"`   // -f to match against full command line
    };
};


let quitting = false;

// Start the application
start().catch(async err => {
  console.error(chalk.red('Critical startup error:'), err);
  await cleanup('Startup error', err, { exit: true });
});

async function promptUser(question, options) {
  const choices = options.map((opt, i) => ({
    name: `${i + 1}. ${opt.text}`,
    value: opt.value
  }));
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

// --- MODIFIED: findExecutablePath ---
// Finds the executable path for a given browser definition
async function findExecutablePath(browserDef) {
    const platform = process.platform;
    const execName = browserDef.executables[platform];

    // 1. Check predefined defaultPaths
    for (const p of browserDef.defaultPaths) {
        // Ensure path is relevant for current platform (e.g. C:\ for win32)
        if ((platform === 'win32' && p.includes(':')) || (platform !== 'win32' && p.startsWith('/'))) {
            try {
                await fs.access(p, fs.constants.X_OK); // Check if exists and is executable
                DEBUG.verbose && console.log(`Found ${browserDef.name} at default path: ${p}`);
                return p;
            } catch { /* Path not accessible or doesn't exist */ }
        }
    }

    // 2. Check system PATH (where/command -v)
    if (execName) {
        try {
            const cmd = platform === 'win32' ? `where ${execName}` : `command -v ${execName}`;
            const { stdout } = await execAsync(cmd, { shell: platform === 'win32' ? 'cmd.exe' : '/bin/bash' });
            const foundPath = stdout.trim().split('\n')[0]; // Take the first result
            if (foundPath) {
                 await fs.access(foundPath, fs.constants.X_OK); // Verify it's executable
                 DEBUG.verbose && console.log(`Found ${browserDef.name} in PATH: ${foundPath}`);
                 return foundPath;
            }
        } catch { /* Not in PATH or not executable */ }
    }
    
    DEBUG.verbose && console.log(`Executable path for ${browserDef.name} not found.`);
    return null;
}


async function detectInstalledBrowsers() {
  const installed = [];
  for (const browserDef of BROWSERS) {
    const executablePath = await findExecutablePath(browserDef);
    if (executablePath) {
      // Store the found executable path in the browser definition for later use
      installed.push({ ...browserDef, foundPath: executablePath });
    }
  }
  return installed;
}

async function checkIsConnectable(browserDef) { // Takes browserDef
  const hosts = ['localhost', '127.0.0.1', '[::1]'];
  for (const host of hosts) {
    try {
      const url = `http://${host}:${chrome_port}/json/version`;
      DEBUG.verbose && console.log(`RDP Check: Testing ${url} for ${browserDef.name}`);
      // node-fetch might require specific agent for http, or adjust timeout
      const response = await fetch(url, { timeout: 700 }); // 700ms timeout
      if (response.ok) {
        const data = await response.json();
        DEBUG.verbose && console.log(`RDP Response from ${host}:${chrome_port}:`, data.Browser);
        if (data.Browser && browserDef.rdpBrowserName.test(data.Browser)) {
          DEBUG.verbose && console.log(chalk.green(`RDP Connectable: ${browserDef.name} on ${host}:${chrome_port}`));
          return true;
        }
      }
    } catch (e) {
      DEBUG.verboseSlow && console.warn(chalk.yellow(`RDP check failed for ${browserDef.name} on ${host}:${chrome_port}: ${e.message.split('\n')[0]}`));
    }
  }
  return false;
}

async function detectBrowsers() {
  const processes = await psList();
  (DEBUG.verbose || DEBUG.showList) && console.log("Running processes:", processes.map(p=>p.name).filter(Boolean).join(', '));

  const installedBrowserDefs = await detectInstalledBrowsers(); // These now include 'foundPath'
  
  const browserStatus = await Promise.all(
    // Map over all BROWSERS definitions, but enrich with foundPath if installed
    BROWSERS.map(async baseBrowserDef => {
      const installedDef = installedBrowserDefs.find(ib => ib.name === baseBrowserDef.name);
      const browserDef = installedDef || baseBrowserDef; // Use enriched def if available

      const proc = processes.find(({ name, cmd, path: procPath }) => {
        // Try to match against the psPattern or the executable name
        const execNameForPs = browserDef.executables[process.platform];
        return (name && browserDef.psPattern.test(name)) || 
               (cmd && browserDef.psPattern.test(cmd)) ||
               (procPath && execNameForPs && procPath.toLowerCase().includes(execNameForPs.toLowerCase()));
      });
      const isRunning = !!proc;
      const isConnectable = isRunning && browserDef.foundPath && await checkIsConnectable(browserDef); // Only check if installed
      
      return { 
        ...browserDef, // Includes name, psPattern, executables, defaultPaths, rdpBrowserName, packageName
        isInstalled: !!browserDef.foundPath, // True if foundPath exists
        isRunning, 
        isConnectable, 
        proc 
        // foundPath is already part of browserDef if installed
      };
    })
  );

  const installed = browserStatus.filter(b => b.isInstalled);
  const running = browserStatus.filter(b => b.isRunning && b.isInstalled); // Only consider installed browsers as "running" for our purposes
  
  return { installed, running, all: browserStatus };
}


async function killBrowser(browserName) {
  const browserDefinition = BROWSERS.find(b => b.name === browserName);
  if (!browserDefinition) {
      console.warn(chalk.yellow(`No definition found for browser ${browserName} to kill.`));
      return;
  }
  const execNameForKill = browserDefinition.executables[process.platform];
  if (!execNameForKill) {
      console.warn(chalk.yellow(`No executable defined for ${browserName} on ${process.platform} to kill.`));
      return;
  }

  const killCommands = KILL_ON(browserDefinition); // Pass the full definition
  if (!(process.platform in killCommands)) {
    console.warn(chalk.yellow(`Platform ${process.platform} not supported for killing ${browserName}. Please close it manually.`));
    return;
  }

  try {
    console.log(chalk.cyan(`Attempting to shut down ${browserName} (processes matching ${execNameForKill})...`));
    const killCommand = killCommands[process.platform];
    DEBUG.verbose && console.log(`Executing kill command: ${killCommand}`);
    const { stdout, stderr } = await execAsync(killCommand, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash' });
    
    if (stderr && !stderr.toLowerCase().includes('no tasks running') && !stderr.toLowerCase().includes('not found') && !stderr.toLowerCase().includes('no process found')) {
      DEBUG.verboseSlow && console.warn(chalk.yellow(`Error output during kill for ${browserName}: ${stderr.trim()}`));
      console.log(chalk.cyan(`${browserName} might not have been running or an issue occurred during shutdown.`));
    } else if (stdout.toLowerCase().includes('terminated') || stdout.toLowerCase().includes('success') || !stderr || stderr.toLowerCase().includes('no tasks running') || stderr.toLowerCase().includes('not found') || stderr.toLowerCase().includes('no process found')) {
      console.log(chalk.green(`${browserName} processes shut down or were not running.`));
    } else {
      console.log(chalk.green(`${browserName} shutdown command issued.`));
    }
    await sleep(1000);
  } catch (e) {
    if (e.message.toLowerCase().includes('process not found') || e.message.toLowerCase().includes('no matching processes') || e.message.toLowerCase().includes('no tasks running')) {
        console.log(chalk.cyan(`${browserName} was not found or already closed.`));
    } else {
        console.warn(chalk.yellow(`Error executing kill command for ${browserName}: ${e.message}`));
    }
  }
}

async function cleanTempCache() {
  const tempDir = args.temp_browser_cache();
  try {
    await fs.access(tempDir); // Check if exists first
    console.log(chalk.cyan(`Removing temporary browser cache (${tempDir})...`));
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(chalk.green(`Temporary cache deleted.`));
  } catch (e) {
    if (e.code === 'ENOENT') {
        DEBUG.verbose && console.log(chalk.cyan(`Temporary cache directory (${tempDir}) not found, nothing to delete.`));
    } else {
        console.warn(chalk.yellow(`Error deleting temporary cache: ${e.message}`));
    }
  }
}

async function start() {
  console.log(chalk.cyan(`DownloadNet starting...`));

  const signals = ['error', 'unhandledRejection', 'uncaughtException', 'SIGHUP', 'beforeExit'];
  signals.forEach(signal => process.on(signal, async (err) => await cleanup(err?.message || signal, err)));
  const exitSignals = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGBREAK', 'SIGABRT'];
  exitSignals.forEach(signal => process.on(signal, async (code) => await cleanup(code, 'signal', { exit: true })));

  console.log(chalk.cyan(`Checking browsers...`));
  const { installed, running, all: browserStatus } = await detectBrowsers();
  const connectable = browserStatus.filter(b => b.isConnectable && b.isInstalled);

  console.log(chalk.blue.bold(`\nBrowser Status:`));
  if ( DEBUG.verbose ) {
    console.log(chalk.cyan(`  Installed: ${installed.map(b => `${b.name} (at ${b.foundPath || 'path not confirmed'})`).join(', ') || 'None'}`));
  } else {
    console.log(chalk.cyan(`  Installed: ${installed.map(b => `${b.name}`).join(', ') || 'None'}`));
  }
  console.log(chalk.cyan(`  Running:   ${running.map(b => b.name).join(', ') || 'None'}`));
  console.log(chalk.cyan(`  Connectable: ${connectable.map(b => b.name).join(', ') || 'None'}`));

  let action = null;
  const menuOptions = [];

  connectable.forEach(b => menuOptions.push({
    text: `Use running ${b.name} (already open and connectable)`,
    value: { action: 'connect', browser: b },
    default: true
  }));

  running.forEach(b => {
    // Only offer relaunch if not already connectable, or if user might want a fresh start
    if (!connectable.some(cb => cb.name === b.name)) {
        menuOptions.push({
            text: `Relaunch ${b.name} (to enable archiving features)`,
            value: { action: 'relaunch', browser: b }
        });
    }
  });
  
  // Offer to launch installed but not running browsers
  installed.forEach(b => {
    if (!running.some(rb => rb.name === b.name)) {
      menuOptions.push({
        text: `Launch ${b.name} (new instance)`,
        value: { action: 'launch', browser: b }
      });
    }
  });

  // Offer to install browsers not detected as installed
  BROWSERS.forEach(bDef => {
    if (!installed.some(ib => ib.name === bDef.name)) {
      menuOptions.push({
        text: `Install and launch ${bDef.name} (requires installation)`,
        value: { action: 'install', browser: bDef } // Pass the base definition
      });
    }
  });
  
  if (running.length > 0) {
    menuOptions.push({
      text: 'Shut down all detected browser processes and exit',
      value: { action: 'shutdown_all_and_exit' }
    });
  }
  menuOptions.push({ text: 'Exit', value: { action: 'exit_only' } });

  const uniqueMenuOptions = [];
  const seenValues = new Set();
  for (const opt of menuOptions) {
      let key = opt.value.action;
      if (opt.value.browser) key += `_${opt.value.browser.name}`;
      if (!seenValues.has(key)) {
          uniqueMenuOptions.push(opt);
          seenValues.add(key);
      } else if (opt.default) {
          const existingIndex = uniqueMenuOptions.findIndex(uo => (uo.value.action + (uo.value.browser ? `_${uo.value.browser.name}`: '')) === key);
          if (existingIndex !== -1) uniqueMenuOptions[existingIndex] = opt;
      }
  }

  if (uniqueMenuOptions.some(opt => opt.value.action !== 'exit_only')) {
    action = await promptUser('Select an action:', uniqueMenuOptions);
  } else {
    console.log(chalk.red('No actionable browser options. Please install a compatible browser.'));
    await cleanup('No browsers available or actionable', null, { exit: true });
    return;
  }

  if (!action || action.action === 'exit_only') {
    console.log(chalk.cyan('Exiting as requested.'));
    await cleanup('User chose to exit', null, { exit: true });
    return;
  }

  if (action.action === 'shutdown_all_and_exit') {
    console.log(chalk.cyan('Attempting to shut down all detected running browser processes...'));
    const runningToKill = browserStatus.filter(b => b.isRunning && b.isInstalled); // Get full defs
    if (runningToKill.length > 0) {
      for (const browserToKill of runningToKill) {
        await killBrowser(browserToKill.name); // killBrowser uses name to find definition
      }
      console.log(chalk.green('Shutdown commands issued for all detected running browser processes.'));
    } else {
      console.log(chalk.cyan('No running browser processes (that we manage) were detected to shut down.'));
    }
    await cleanup('User chose to shut down all browsers and exit', null, { exit: true });
    return;
  }

  let browserToUse = action.browser; // This is a browser definition object

  if (action.action === 'connect') {
    console.log(chalk.cyan(`Connecting to running ${browserToUse.name}...`));
  } else if (action.action === 'relaunch') {
    console.log(chalk.cyan(`Relaunching ${browserToUse.name}...`));
    await killBrowser(browserToUse.name);
    action.action = 'launch'; // Proceed to launch
  } else if (action.action === 'install') {
    console.log(chalk.red(`\n${browserToUse.name} is not installed or not found.`));
    const pkgInfo = browserToUse.packageName[process.platform];
    if (pkgInfo) {
        if (pkgInfo.startsWith('http')) {
            console.log(chalk.cyan(`  Please download and install from: ${pkgInfo}`));
        } else if (process.platform === 'linux') {
            console.log(chalk.cyan(`  For example, on Ubuntu/Debian, try: sudo apt update && sudo apt install ${pkgInfo}`));
        } else if (process.platform === 'freebsd') {
            console.log(chalk.cyan(`  For example, try: sudo pkg install ${pkgInfo}`));
        } else {
            console.log(chalk.cyan(`  Please visit the ${browserToUse.name} website to download and install.`));
        }
    } else {
        console.log(chalk.cyan(`  No specific installation instructions for ${browserToUse.name} on ${process.platform}. Please visit its website.`));
    }
    await cleanup(`${browserToUse.name} not installed`, null, { exit: true });
    return;
  }

  // Ensure browserToUse has foundPath if we are launching/relaunching
  if (action.action === 'launch' && !browserToUse.foundPath) {
      console.error(chalk.red(`Error: Attempting to launch ${browserToUse.name}, but its executable path was not found.`));
      console.log(chalk.yellow(`Please ensure ${browserToUse.name} is installed correctly and accessible.`));
      await cleanup('Executable path missing for launch', null, { exit: true });
      return;
  }

  await cleanTempCache();
  console.log(chalk.cyan(`Launching library server...`));
  await LibraryServer.start({ server_port });
  console.log(chalk.green(`Library server started on port ${server_port}.`));

  let launchedBrowserProcess = null;
  if (action.action === 'launch') {
    console.log(chalk.cyan(`Launching ${browserToUse.name} from ${browserToUse.foundPath}...`));
    
    const browserArgsForLaunch = [
        ...BASE_CHROME_FLAGS, // Includes remote debugging port
        `--user-data-dir=${path.resolve(os.homedir(), '.config', 'dosaygo', 'DN-Profile')}`,
        // Add any browser-specific flags if needed, e.g. based on browserToUse.name
        // For now, assuming BASE_CHROME_FLAGS are generic enough for Chromium-based ones
        `${GO_SECURE ? 'https' : 'http'}://localhost:${server_port}` // Starting URL
    ];
    
    // Remove userDataDir: false from LAUNCH_OPTS if it was there, as it's not a standard spawn option.
    // userDataDir is typically a flag like --user-data-dir=...
    // If you want a specific user data dir, add it to browserArgsForLaunch.
    // For a fresh profile, many browsers do this by default if no --user-data-dir is set,
    // or you might need a specific flag like --guest or ensure no existing profile is picked up.
    // For now, we are not explicitly setting --user-data-dir for a throwaway profile.
    // If args.temp_browser_profile() is desired:
    // browserArgsForLaunch.push(`--user-data-dir=${args.temp_browser_profile()}`);


    launchedBrowserProcess = BrowserLauncher.launch(browserToUse.foundPath, browserArgsForLaunch);

    if (!launchedBrowserProcess) {
      console.error(chalk.red(`Failed to launch ${browserToUse.name}.`));
      await cleanup('Browser launch failed', null, { exit: true });
      return;
    }

    launchedBrowserProcess.on('exit', async (code, signal) => {
      const exitReason = code !== null ? `exited with code ${code}` : `killed by signal ${signal}`;
      console.log(chalk.magenta(`Browser process (${browserToUse.name}) ${exitReason}.`));
      if (!quitting) { // Avoid info message if we are intentionally quitting everything
        console.info(chalk.cyan(`
          ---------------------------------------------------------------------
          INFO: Browser exited. If this was unexpected or too quick:
          - Check for error messages above from the browser process.
          - If running headless (DK_HEADLESS=true), ensure your setup is correct.
            You might need a display server like Xvfb on Linux if not using --headless=new.
          - The browser might have crashed or failed to start with the given flags.
          ---------------------------------------------------------------------
        `));
      }
      await cleanup(`Browser ${exitReason}`, null, { exit: true });
    });

    // Give the browser a moment to start up and open the remote debugging port
    console.log(chalk.green(`${browserToUse.name} launched. PID: ${launchedBrowserProcess.pid}. Waiting for it to become connectable...`));
    await sleep(2500); // Wait a bit for RDP to be available
    
    // Verify connectability after launch
    const isNowConnectable = await checkIsConnectable(browserToUse);
    if (!isNowConnectable) {
        console.warn(chalk.yellow(`Launched ${browserToUse.name}, but it's not connectable on port ${chrome_port} after waiting.`));
        console.warn(chalk.yellow(`Archivist might not function correctly. Check browser console for errors.`));
        // Decide if this is a fatal error or if we should proceed with caution
        // For now, proceed with caution.
    } else {
        console.log(chalk.green(`${browserToUse.name} is connectable.`));
    }

  } else if (action.action === 'connect') {
    console.log(chalk.cyan(`Proceeding with already running and connectable ${browserToUse.name}.`));
  }

  if (quitting) return;

  console.log(chalk.cyan(`Launching archivist and connecting to browser on port ${chrome_port}...`));
  await Archivist.collect({ chrome_port, mode });
  console.log(chalk.green.bold(`System ready. Archivist connected.`));
}

async function cleanup(reason, err, { exit = false } = {}) {
  if (quitting && exit) {
    DEBUG.verbose && console.log(chalk.cyan(`Cleanup already in progress for exit. Reason: ${reason}`));
    return;
  }
  console.log(chalk.cyan(`\nInitiating shutdown sequence. Reason: ${reason}`));
  if (err) {
    console.error(chalk.red('Error during operation or shutdown:'), err instanceof Error ? err.stack : err);
  }

  if (exit) quitting = true;

  DEBUG.verbose && console.log(chalk.yellow(`Cleanup called. Reason: ${reason}`));

  Archivist.shutdown(); // Signal archivist to stop its work
  LibraryServer.stop(); // Stop the HTTP server

  // Note: We don't explicitly kill the browser here if it was launched by us.
  // Its 'exit' handler calls cleanup. If the user chose 'connect', we don't own the process.
  // If 'shutdown_all_and_exit' was chosen, browsers were killed before this.

  if (exit) {
    console.log(chalk.cyan(`All components signaled to stop. Exiting in 3 seconds...`));
    await sleep(3000);
    process.exit(err instanceof Error ? 1 : 0);
  }
}
