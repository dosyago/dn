import {launch as ChromeLaunch} from 'chrome-launcher';

import {DEBUG} from './common.js';

import Archivist from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const CHROME_OPTS = !DEBUG ? [] : [
  '--no-sandbox'
];
const {server_port, mode, chrome_port} = args;

start();

async function start() {
  //await ChromeLaunch({port: chrome_port, chromeFlags:CHROME_OPTS});
  await LibraryServer.start({server_port});
  await Archivist.collect({chrome_port, mode});
}
