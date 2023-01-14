import fs from 'fs';
import ChildProcess from 'child_process';
import readline from 'readline';
import util from 'util';
import {stdin as input, stdout as output} from 'process';

import ChromeLauncher from 'chrome-launcher';
import psList from 'ps-list';

import {DEBUG, sleep, NO_SANDBOX, GO_SECURE} from './common.js';

import {Archivist} from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const {server_port, mode, chrome_port} = args;
const CHROME_OPTS = !NO_SANDBOX ? [
  /*'--restore-last-session',*/
  `--disk-cache-dir=${args.temp_browser_cache()}`,
  `--aggressive-cache-discard`
] : [
  /*'--restore-last-session',*/
  `--disk-cache-dir=${args.temp_browser_cache()}`,
  `--aggressive-cache-discard`,
  '--no-sandbox',
];
const LAUNCH_OPTS = {
  logLevel: DEBUG ? 'verbose' : 'silent',
  port: chrome_port, 
  chromeFlags:CHROME_OPTS, 
  userDataDir:false, 
  startingUrl: `${GO_SECURE ? 'https' : 'http'}://localhost:${args.server_port}`,
  ignoreDefaultFlags: true
}
const KILL_ON = {
  win32: 'taskkill /IM chrome.exe /F',
  darwin: 'kill $(pgrep Chrome)',
  freebsd: 'pkill -15 chrome',
  linux: 'pkill -15 chrome',
};

let quitting;

start();

async function start() {
  console.log(`Running in node...`);

  process.on('error', cleanup);
  process.on('unhandledRejection', cleanup);
  process.on('uncaughtException', cleanup);
  process.on('SIGHUP', cleanup);
  process.on('beforeExit', cleanup);
  process.on('SIGINT', code => cleanup(code, 'signal', {exit:true}));
  process.on('SIGTERM', code => cleanup(code, 'signal',  {exit:true}));
  process.on('SIGQUIT', code => cleanup(code, 'signal',  {exit:true}));
  process.on('SIGBREAK', code => cleanup(code, 'signal', {exit:true}));
  process.on('SIGABRT', code => cleanup(code, 'signal',  {exit:true}));

  console.log(`Importing dependencies...`);
  const {launch:ChromeLaunch} = ChromeLauncher;

  let chromeOpen = false;

  const list = await psList();

  chromeOpen = list.some(({name,cmd}) => name.match(/chrome/g) || cmd.match(/chrome/g));

  if ( chromeOpen ) {
    console.info(`Seems Chrome is open`);
    if ( DEBUG.askFirst ) {
      const rl = readline.createInterface({input, output});
      const question = util.promisify(rl.question).bind(rl);
      console.info(`\nIf you don't shut down Chrome and restart it under DiskerNet control 
        you will not be able to save or serve your archives.\n`);
      const answer = await question("Would you like to shutdown Chrome browser now (y/N) ? ");
      if ( answer?.match(/^y/i) ) {
        await killChrome(); 
      } else {
        console.log(`OK, not shutting it!\n`);
        if ( chromeOpen ) {
          process.exit(0);
        }
      }
    } else {
      await killChrome(); 
    }
  }

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
    DEBUG.verboseSlow && console.info('Chrome launch error:', e);
    process.exit(1);
  }
  console.log(`Chrome started.`);

  console.log(`Waiting 1 second...`);
  await sleep(1000);
  console.log(`Launching archivist and connecting to browser...`);
  await Archivist.collect({chrome_port, mode});
  console.log(`System ready.`);
}

async function killChrome(wait = true) {
  try {
    if ( process.platform in KILL_ON ) {
      console.log(`Attempting to shut running chrome...`);
      const [err] = (await new Promise(
        res => ChildProcess.exec(KILL_ON[process.platform], (...a) => res(a))
      ));
      if ( err ) {
        console.log(`There was no running chrome.`);
        DEBUG.verboseSlow && console.warn("Error closing existing chrome", err);
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

async function cleanup(reason, err, {exit = false} = {}) {
  console.log(`Cleanup called on reason: ${reason}`, err);

  if ( quitting ) {
    console.log(`Cleanup already called so not running again.`);
    return;
  }
  quitting = true;

  Archivist.shutdown();

  LibraryServer.stop();

  killChrome(false); 

  if ( exit ) {
    console.log(`Take a breath. Everything's done. DiskerNet is exiting in 3 seconds...`);

    await sleep(3000);

    process.exit(0);
  }
} 
