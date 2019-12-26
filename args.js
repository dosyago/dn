import os from 'os';
import path from 'path';
import fs from 'fs';

const server_port = process.env.PORT || process.argv[2] || 22120;
const mode = process.argv[3] || 'save';
const chrome_port = process.argv[4] || 9222;
const library_path = process.argv[5] || path.resolve(os.homedir(), '22120-arc', 'public', 'library');

if ( !fs.existsSync(library_path) ) {
  console.log(`Archive directory (${library_path}) does not exist, creating...`);
  fs.mkdirSync(library_path, {recursive:true});
  console.log(`Created.`);
}

console.log(`Args usage: <server_port> <save|serve> <chrome_port> <library_path>`);

const args = {
  server_port, mode, 
  chrome_port,
  library_path
};

export default args;
