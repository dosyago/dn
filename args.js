import os from 'os';
import path from 'path';
import fs from 'fs';

const server_port = process.env.PORT || process.argv[2] || 22120;
const mode = process.argv[3] || 'save';
const chrome_port = process.argv[4] || 9222;

const Pref = {};
const pref_file = path.resolve(os.homedir(), '.22120.config.json');
const cacheId = Math.random();

loadPref();

let BasePath = Pref.BasePath;
const archive_root = () => path.resolve(BasePath, '22120-arc');
const no_file = () => path.resolve(archive_root(), 'no.json');
const temp_browser_cache = () => path.resolve(archive_root(), 'temp-browser-cache' + cacheId);
const library_path = () => path.resolve(archive_root(), 'public', 'library');
const cache_file = () => path.resolve(library_path(), 'cache.json');
const index_file = () => path.resolve(library_path(), 'index.json');

console.log(`Args usage: <server_port> <save|serve> <chrome_port> <library_path>`);

updateBasePath(process.argv[5] || Pref.BasePath || os.homedir());

const args = {
  mode,

  server_port, 
  chrome_port,

  updateBasePath,
  getBasePath,

  library_path,
  no_file,
  temp_browser_cache,
  cache_file,
  index_file
};

export default args;

function updateBasePath(new_base_path) {
  new_base_path = path.resolve(new_base_path);
  if ( BasePath == new_base_path ) {
    return false;
  }

  console.log(`Updating base path from ${BasePath} to ${new_base_path}...`);
  BasePath = new_base_path;

  if ( !fs.existsSync(library_path()) ) {
    console.log(`Archive directory (${library_path()}) does not exist, creating...`);
    fs.mkdirSync(library_path(), {recursive:true});
    console.log(`Created.`);
  }

  if ( !fs.existsSync(cache_file()) ) {
    console.log(`Cache file does not exist, creating...`); 
    fs.writeFileSync(cache_file(), JSON.stringify([]));
    console.log(`Created!`);
  }

  if ( !fs.existsSync(index_file()) ) {
    console.log(`Index file does not exist, creating...`); 
    fs.writeFileSync(index_file(), JSON.stringify([]));
    console.log(`Created!`);
  }

  console.log(`Base path updated to: ${BasePath}. Saving to preferences...`);
  Pref.BasePath = BasePath;
  savePref();
  console.log(`Saved!`);

  return true;
}

function getBasePath() {
  return BasePath;
}

function loadPref() {
  if ( fs.existsSync(pref_file) ) {
    try {
      Object.assign(Pref, JSON.parse(fs.readFileSync(pref_file)));
    } catch(e) {
      console.warn("Error reading from preferences file", e);
    }
  } else {
    console.log("Preferences file does not exist. Creating one..."); 
    savePref();
  }
}

function savePref() {
  try {
    fs.writeFileSync(pref_file, JSON.stringify(Pref,null,2));
  } catch(e) {
    console.warn("Error writing preferences file", pref_file, Pref, e);
  }
}

