import {DEBUG, context, sleep, NO_SANDBOX} from './common.js';

import Archivist from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const {server_port, mode, chrome_port} = args;
const CHROME_OPTS = !NO_SANDBOX ? [
  '--restore-last-session',
  `--disk-cache-dir=${args.temp_browser_cache()}`,
  `--aggressive-cache-discard`
] : [
  '--restore-last-session',
  `--disk-cache-dir=${args.temp_browser_cache()}`,
  `--aggressive-cache-discard`,
  '--no-sandbox'
];
const LAUNCH_OPTS = {
  logLevel: DEBUG ? 'verbose' : 'silent',
  port: chrome_port, 
  chromeFlags:CHROME_OPTS, 
  userDataDir:false, 
  startingUrl: `http://localhost:${args.server_port}`,
  ignoreDefaultFlags: true
}
const KILL_ON = {
  win32: 'taskkill /IM chrome.exe /F',
  darwin: 'pkill -15 chrome',
  freebsd: 'pkill -15 chrome',
  linux: 'pkill -15 chrome',
};

let quitting, ChildProcess;

start();

async function start() {
  if ( context == 'node' ) {
    console.log(`Running in node...`);

    process.on('beforeExit', cleanup);
    process.on('SIGBREAK', cleanup);
    process.on('SIGHUP', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    console.log(`Importing dependencies...`);
    const fs = await import('fs');
    const {launch:ChromeLaunch} = await import('chrome-launcher');

    await killChrome();

    console.log(`Removing 22120's existing temporary browser cache if it exists...`);
    if ( fs.existsSync(args.temp_browser_cache()) ) {
      console.log(`Temp browser cache directory (${args.temp_browser_cache()}) exists, deleting...`);
      fs.rmdirSync(args.temp_browser_cache(), {recursive:true});
      console.log(`Deleted.`);
    }
    console.log(`Launching library server...`);
    await LibraryServer.start({server_port});
    console.log(`Library server started.`);

    console.log(`Waiting 1 second...`);
    await sleep(1000);

    console.log(`Launching chrome...`);
    try {
      await ChromeLaunch(LAUNCH_OPTS);
    } catch(e) {
      console.log(`Could not launch chrome.`);
      DEBUG && console.info('Chrome launch error:', e);
      process.exit(1);
    }
    console.log(`Chrome started.`);

    console.log(`Waiting 1 second...`);
    await sleep(1000);
  }
  console.log(`Launching archivist and connecting to browser...`);
  await Archivist.collect({chrome_port, mode});
  console.log(`System ready.`);
}

async function killChrome(wait = true) {
  try {
    if ( process.platform in KILL_ON ) {
      console.log(`Attempting to shut running chrome...`);
      if ( ! ChildProcess ) {
        const {default:child_process} = await import('child_process');
        ChildProcess = child_process;
      }
      const [err, stdout, stderr] = (await new Promise(
        res => ChildProcess.exec(KILL_ON[process.platform], (...a) => res(a))
      ));
      if ( err ) {
        console.log(`There was no running chrome.`);
        //DEBUG && console.warn("Error closing existing chrome", err);
      } else {
        console.log(`Running chrome shut down.`);
        if ( wait ) {
          console.log(`Waiting 1 second...`);
          await sleep(1000);
        }
      }
    } else {
      console.warn(`If you have chrome running, you may need to shut it down manually and restart 22120.`);
    }
  } catch(e) {
    console.warn("in kill chrome", e);
  }
}

async function cleanup(reason) {
  console.log(`Cleanup called on reason: ${reason}`);

  if ( quitting ) {
    console.log(`Cleanup already called so not running again.`);
    return;
  }
  quitting = true;

  Archivist.shutdown();

  LibraryServer.stop();

  killChrome(false); 

  console.log(`Take a breath. Everything's done. 22120 is exiting in 3 seconds...`);

  await sleep(3000);

  process.exit(0);
} 
