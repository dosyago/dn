import {launch as ChromeLaunch} from 'chrome-launcher';

import {DEBUG} from './common.js';

import Archivist from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const CHROME_OPTS = DEBUG ? [
  '--no-sandbox'
] : []
const server_port = process.env.PORT || args.server_port || 8080;
const mode = args.mode;
const chrome_port = args.chrome_port || 9222;

start();

async function start() {
  //await ChromeLaunch({port: chrome_port, chromeFlags:CHROME_OPTS});
  await LibraryServer.start({server_port});
  await Archivist.collect({chrome_port, mode});
}
