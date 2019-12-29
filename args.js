import os from 'os';
import path from 'path';
import fs from 'fs';

const server_port = process.env.PORT || process.argv[2] || 22120;
const mode = process.argv[3] || 'save';
const chrome_port = process.argv[4] || 9222;
const library_path = process.argv[5] || path.resolve(os.homedir(), '22120-arc', 'public', 'library');
const temp_browser_cache = path.resolve(os.homedir(), '22120-arc', 'temp-browser-cache');

if ( !fs.existsSync(library_path) ) {
  console.log(`Archive directory (${library_path}) does not exist, creating...`);
  fs.mkdirSync(library_path, {recursive:true});
  console.log(`Created.`);
}

if ( fs.existsSync(temp_browser_cache) ) {
  console.log(`Temp browser cache directory (${temp_browser_cache}) exists, deleting...`);
  fs.rmdirSync(temp_browser_cache, {recursive:true});
  console.log(`Deleted.`);
}

console.log(`Args usage: <server_port> <save|serve> <chrome_port> <library_path>`);

const args = {
  server_port, mode, 
  chrome_port,
  library_path,
  temp_browser_cache
};

export default args;
