import fs from 'fs';
import ChildProcess from 'child_process';
import util from 'util';
import readline from 'readline';
import {stdin as input, stdout as output} from 'process';

import ChromeLauncher from './launcher.js';
import psList from '@667/ps-list';

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
const KILL_ON = (browser) => ({
  win32: `taskkill /IM ${browser}.exe /F`,
  darwin: `kill $(pgrep -i ${browser})`,
  freebsd: `pkill -15 ${browser}`,
  linux: `pkill -15 ${browser}`,
});
let Browser;

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

  const list = await psList();

  const chromeOpen = list.filter(({name,cmd}) => name?.match?.(/^(chrome|google chrome)/gi) || cmd?.match?.(/[\/\\]chrome/gi));
  const vivaldiOpen = list.filter(({name,cmd}) => name?.match?.(/^vivaldi/gi) || cmd?.match?.(/[\/\\]vivaldi/gi));
  const braveOpen = list.filter(({name,cmd}) => name?.match?.(/^brave/gi) || cmd?.match?.(/[\/\\]brave/gi));
  const edgeOpen = list.filter(({name,cmd}) => name?.match?.(/^edge/gi) || cmd?.match?.(/[\/\\]edge/gi));
  const browserOpen = chromeOpen || vivaldiOpen || braveOpen || edgeOpen;
  const browsers = [{chromeOpen}, {vivaldiOpen}, {braveOpen}, {edgeOpen}];

  if ( browserOpen ) {
    let shutOne = false;
    for( const status of browsers ) {
      const keyName = Object.keys(status)[0];
      if ( !status[keyName] || !status[keyName].length ) continue;
      console.log(status);
      const openBrowserCode = keyName.replace('Open', '');
      Browser = openBrowserCode;
      console.info(`Seems ${openBrowserCode} is open`);
      if ( DEBUG.askFirst ) {
        const rl = readline.createInterface({input, output});
        const question = util.promisify(rl.question).bind(rl);
        console.info(`\nDo you want to use it for your archiving? The reason we ask is, because if you don't shut down ${openBrowserCode} and restart it under DownloadNet control you will not be able to use it to save or serve your archives.\n`);
        const answer = await question(`Would you like to shutdown ${openBrowserCode} browser now (y/N) ? `);
        if ( answer?.match(/^y/i) ) {
          await killBrowser(openBrowserCode); 
          shutOne = true;
        } else {
          console.log(`OK, not shutting it!\n`);
        }
      } else {
        await killBrowser(openBrowserCode); 
      }
    }
    if ( !shutOne ) {
      process.exit(0);
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

  console.log(`Launching browser...`);
  try {
    await ChromeLaunch(LAUNCH_OPTS);
  } catch(e) {
    console.log(`Could not launch browser.`);
    DEBUG.verboseSlow && console.info('Chrome launch error:', e);
    process.exit(1);
  }
  console.log(`Browser started.`);

  console.log(`Waiting 1 second...`);
  await sleep(1000);
  console.log(`Launching archivist and connecting to browser...`);
  await Archivist.collect({chrome_port, mode});
  console.log(`System ready.`);
}

async function killBrowser(browser, wait = true) {
  try {
    if ( process.platform in KILL_ON(browser) ) {
      console.log(`Attempting to shut running browser...`);
      const [err] = (await new Promise(
        res => ChildProcess.exec(KILL_ON(browser)[process.platform], (...a) => res(a))
      ));
      if ( err ) {
        console.log(`There was no running browser.`);
        DEBUG.verboseSlow && console.warn("Error closing existing browser", err);
      } else {
        console.log(`Running browser shut down.`);
        if ( wait ) {
          console.log(`Waiting 1 second...`);
          await sleep(1000);
        }
      }
    } else {
      console.warn(`If you have browser running, you may need to shut it down manually and restart 22120.`);
    }
  } catch(e) {
    console.warn("in kill browser", e);
  }
}

async function cleanup(reason, err, {exit = false} = {}) {
  console.log(`Shutting down everything because of an error!`);
  console.log(`Cleanup called on reason: ${reason}`, err);

  if ( quitting ) {
    console.log(`Cleanup already called so not running again.`);
    return;
  }
  quitting = true;

  Archivist.shutdown();

  LibraryServer.stop();

  //killBrowser(Browser, false); 

  if ( exit ) {
    console.log(`Take a breath. Everything's done. DownloadNet is exiting in 3 seconds...`);

    await sleep(3000);

    process.exit(0);
  }
} 
