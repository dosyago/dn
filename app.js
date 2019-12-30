import {DEBUG, context} from './common.js';

import Archivist from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const {server_port, mode, chrome_port} = args;
const CHROME_OPTS = !DEBUG ? [
  '--restore-last-session',
  `--disk-cache-dir=${args.temp_browser_cache}`,
] : [
  '--restore-last-session',
  `--disk-cache-dir=${args.temp_browser_cache}`,
  '--no-sandbox'
];
const LAUNCH_OPTS = {
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
start();

async function start() {
  if ( context == 'node' ) {
    const fs = await import('fs');
    const {launch:ChromeLaunch} = await import('chrome-launcher');
    const {default:child_process} = await import('child_process');
    if ( process.platform in KILL_ON ) {
      const [err, stdout, stderr] = (await new Promise(
        res => child_process.exec(KILL_ON[process.platform], (...a) => res(a))
      ));
      if ( err ) {
        console.warn(err);
      }
    } else {
      console.warn(`If you have Chrome running, you may need to shut it down manually and restart 22120.`);
    }
    if ( fs.existsSync(args.temp_browser_cache) ) {
      console.log(`Temp browser cache directory (${args.temp_browser_cache}) exists, deleting...`);
      fs.rmdirSync(args.temp_browser_cache, {recursive:true});
      console.log(`Deleted.`);
    }
    await ChromeLaunch(LAUNCH_OPTS);
    await LibraryServer.start({server_port});
  }
  await Archivist.collect({chrome_port, mode});
}
