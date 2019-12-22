import Archivist from './archivist.js';
import LibraryServer from './libraryServer.js';
import args from './args.js';

const server_port = process.env.PORT || args.server_port || 8080;
const mode = args.mode;
const chrome_port = args.chrome_port || 9222;

LibraryServer.start({server_port});
Archivist.collect({chrome_port, mode});
