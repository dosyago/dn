import {DEBUG, context} from './common.js';

import Archivist from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const CHROME_OPTS = !DEBUG ? [] : [
  '--no-sandbox'
];
const {server_port, mode, chrome_port} = args;
let ChromeLaunch;

start();

async function start() {
  if ( context == 'node' ) {
    ({launch:ChromeLaunch} = await import('chrome-launcher'));
    await ChromeLaunch({port: chrome_port, chromeFlags:CHROME_OPTS});
    await LibraryServer.start({server_port});
  }
  await Archivist.collect({chrome_port, mode});
}
