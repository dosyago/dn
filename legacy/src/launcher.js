// launcher.js
import { spawn } from 'child_process';
import { DEBUG } from './common.js'; // Assuming common.js is accessible

/**
 * Launches a browser executable with specified arguments.
 * @param {string} executablePath - Absolute path to the browser executable.
 * @param {string[]} browserArgs - Array of arguments to pass to the browser.
 * @param {object} [options={}] - Options for child_process.spawn.
 * @returns {import('child_process').ChildProcess | null} The spawned browser process or null on error.
 */
function launch(executablePath, browserArgs = [], options = {}) {
  if (!executablePath) {
    console.error('launcher.js: Executable path is required.');
    return null;
  }

  DEBUG.verbose && console.log(`launcher.js: Spawning '${executablePath}' with args:`, browserArgs);

  try {
    const defaultSpawnOptions = {
      detached: process.platform !== 'win32', // Detach by default on non-Windows for independent exit
      stdio: ['ignore', 'pipe', 'pipe'], 
    };

    const spawnOptions = { ...defaultSpawnOptions, ...options };

    const browserProcess = spawn(executablePath, browserArgs, spawnOptions);

    browserProcess.on('error', (err) => {
      console.error(`launcher.js: Failed to start browser process for ${executablePath}: ${err.message}`);
    });

    if (DEBUG.verboseBrowser) {
      const browserName = executablePath.split(/[/\\]/).pop();
      browserProcess.stdout.on('data', (data) => {
        DEBUG.verbose && process.stdout.write(`[BROWSER STDOUT - ${browserName}]: ${data}`);
      });
      browserProcess.stderr.on('data', (data) => {
        DEBUG.verbose && process.stderr.write(`[BROWSER STDERR - ${browserName}]: ${data}`);
      });
    }
    
    // If detached, unref() allows the parent to exit independently.
    // This is often desired so closing the terminal doesn't kill the browser launched by the script.
    if (spawnOptions.detached) {
      browserProcess.unref();
    }

    return browserProcess;
  } catch (error) {
    console.error(`launcher.js: Error spawning browser ${executablePath}: ${error.message}`);
    DEBUG.verbose && console.error(error);
    return null;
  }
}

export default {
  launch,
};
