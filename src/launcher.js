import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import inquirer from 'inquirer';

// regular funcs and data
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
  };

  const getBrowserPath = (browser) => {
    const platform = os.platform();
    return browserPaths[browser][platform];
  };

  const isBrowserInstalled = (browserPath) => {
    try {
      fs.statSync(browserPath);
      return true;
    } catch (err) {
      return false;
    }
  };

  const getInstalledBrowsers = () => {
    return Object.keys(browserPaths).filter((browser) => {
      const browserPath = getBrowserPath(browser);
      return isBrowserInstalled(browserPath);
    });
  };

  const launchBrowser = (browser, url = '', flags = []) => {
    const browserPath = getBrowserPath(browser);
    if (!browserPath) {
      console.error(`Browser path for ${browser} not found.`);
      return;
    }

    const command = `"${browserPath}" ${flags.join(' ')} ${url}`;
    const childProcess = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error launching ${browser}: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`Error output: ${stderr}`);
      }
      console.log(`Browser launched: ${stdout}`);
    });

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

  const isSpecialUrl = (url) => /^chrome|vivaldi|brave|edge/.test(url);

// api facade for parity with ChromeLaunch
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

    const installedBrowsers = getInstalledBrowsers();
    if (installedBrowsers.length === 0) {
      console.error('No supported browsers are installed.');
      return;
    }

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'browser',
        message: 'Select a browser to launch:',
        choices: installedBrowsers,
      },
      ...(fullAsk ? [
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
      ] : [])
    ]);

    const { browser, url, flags: flagString, ignoreSignal = true } = answers;
    const flagArray = flagString ? flagString.split(' ') : [];

    const flags = [
      ...flagArray,
      `--remote-debugging-port=${port}`,
      ...chromeFlags,
      userDataDir ? `--user-data-dir=${userDataDir}` : '',
      ignoreDefaultFlags ? '--no-default-browser-check' : '',
    ].filter(Boolean);

    console.log(`Launching browser with log level: ${logLevel}`);
    const browserProcess = launchBrowser(browser, startingUrl, flags);

    if (!opts.ignoreSignal) {
      process.on('SIGINT', () => {
        console.log('\nReceived SIGINT. Killing browser process...');
        killBrowser(browserProcess);
        process.exit();
      });
    }

    return browserProcess;
  };

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}

// helper
  const run = async () => {
    const installedBrowsers = getInstalledBrowsers();
    if (installedBrowsers.length === 0) {
      console.error('No supported browsers are installed.');
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

