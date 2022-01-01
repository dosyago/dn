import os from 'os';
import Path from 'path';
import fs from 'fs';
import {watch} from 'chokidar';

import {sleep, DEBUG} from './common.js';

// Chrome user data directories by platform. 
  // Source 1: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md 
  // Source 2: https://superuser.com/questions/329112/where-are-the-user-profile-directories-of-google-chrome-located-in

const CHOK_OPTS = {
};

// Note:
  // Not all the below are now used or supported by this code
const UDD_PATHS = {
  'win': '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
  'winxp' : '%USERPROFILE%\\Local Settings\\Application Data\\Google\\Chrome\\User Data',
  'macos' : Path.resolve(os.homedir(), 'Library/Application Support/Google/Chrome'),
  'nix' : Path.resolve(os.homedir(), '.config/google-chrome'),
  'chromeos': '/home/chronos',                        /* no support */
  'ios': 'Library/Application Support/Google/Chrome', /* no support */
};
const PLAT_TABLE = {
  'darwin': 'macos',
  'linux': 'nix'
};
//const PROFILE_DIR_NAME_REGEX = /^(Default|Profile \d+)$/i;
//const isProfileDir = name => PROFILE_DIR_NAME_REGEX.test(name);
const BOOKMARK_FILE_NAME_REGEX = /^Bookmarks(.bak)?$/i;
const isBookmarkFile = name => BOOKMARK_FILE_NAME_REGEX.test(name);
const State = {
  books: new Map(),
};

test();
async function test() {
  for await ( const {path: file,event} of bookmarkChanges() ) {
    if ( file.endsWith('bak') ) continue;
    switch(event) {
      default: {
          try {
            const data = fs.readFileSync(file);
            const jData = JSON.parse(data);
            const changes = flatten(jData, {toMap:true, map: State.books});
            console.log(changes.length);
            console.log(changes.slice(0,10));
          } catch(e) {
            console.warn(`Error reading file ${file} on event ${event}:`, e);
          }
        } break;
    }
  }
}

async function* bookmarkChanges() {
  const rootDir = getProfileRootDir();
  let change = false;
  let notifyChange = false;

  if ( !fs.existsSync(rootDir) ) {
    throw new TypeError(`Sorry! The directory where we thought the Chrome profile directories may be found (${rootDir}), does not exist. We can't monitor changes to your bookmarks, so Bookmark Select Mode is not supported.`);
  }

  const bookmarkWatchGlobs = [
    Path.resolve(rootDir, '**', 'Book*'), 
    Path.resolve(rootDir, '**', 'book*')
  ];

  DEBUG && console.log({bookmarkWatchGlobs});

  const observer = watch(bookmarkWatchGlobs, CHOK_OPTS);
  observer.on('ready', () => {
    DEBUG && console.log(`Ready to watch`);
  });
  observer.on('all', (event, path) => {
    const name = Path.basename(path);
    if ( isBookmarkFile(name) ) {
      DEBUG && console.log(event, path, notifyChange);
      change = {event, path};
      notifyChange && notifyChange();
    }
  });
  observer.on('error', error => {
    console.warn(`Bookmark file watcher error`, error);
  });

  process.on('SIGINT',  shutdown);
  process.on('SIGHUP', shutdown);
  process.on('SIGUSR1', shutdown);
  process.on('SIGUSR2', shutdown);

  while(true) {
    await new Promise(res => notifyChange = res);
    yield change;
  }

  async function shutdown() {
    console.log('Shutdown');
    await observer.close();
    console.log('No longer observing.');
  }
}

function getProfileRootDir() {
  const plat = os.platform();
  let name = PLAT_TABLE[plat];
  let rootDir;

  DEBUG && console.log({plat, name});

  if ( !name ) {
    if ( plat === 'win32' ) {
      // because Chrome profile dir location only changes in XP
        // we only care if it's XP or not and so
        // we try to resolve based on the version major and minor (given by release)
        // source: https://docs.microsoft.com/en-us/windows/win32/sysinfo/operating-system-version?redirectedfrom=MSDN
      const rel = os.release();
      const ver = parseFloat(rel); 
      if ( !Number.isNaN(ver) && ver <= 5.2 ) {
        // this should be reliable
        name = 'winxp';
      } else {
        // this may not be reliable, but we just do it
        name = 'win';
      }
    } else {
      throw new TypeError(
        `Sorry! We don't know how to find the default Chrome profile on OS platform: ${plat}`
      );
    }
  }

  if ( UDD_PATHS[name] ) {
    rootDir = Path.resolve(UDD_PATHS[name]);
  } else {
    throw new TypeError(
      `Sorry! We don't know how to find the default Chrome profile on OS name: ${name}`
    );
  }

  return rootDir;
}

function flatten(bookmarkObj, {toMap: toMap = false, map} = {}) {
  const nodes = [...Object.values(bookmarkObj.roots)];
  const urls = toMap? (map || new Map()) : [];
  const urlSet = new Set();
  const changes = [];

  while(nodes.length) {
    const next = nodes.pop();
    const {name, type, url} = next;
    switch(type) {
      case "url":
        if ( toMap ) {
          if ( map ) {
            if ( urls.has(url) ) {
              const {name:oldName} = urls.get(url);
              if ( name !== oldName ) {
                changes.push({
                  type: "Title updated",
                  url,
                  oldName, 
                  name
                });
              }
            } else {
              changes.push({
                type: "new",
                name, url
              });
            }
            urlSet.add(url);
          } 
          urls.set(url, next);
        } else {
          urls.push(next);
        }
        break;
      case "folder":
        nodes.push(...next.children);
        break;
      default:
        console.info("New type", type, next);
        break;
      
    }
  }

  if (map) {
    [...map.keys()].forEach(url => {
      if ( !urlSet.has(url) ) {
        changes.push({
          type: "delete",
          url
        });
        map.delete(url);
      }
    });
  }

  return map ? changes : urls;
}


/*
function* profileDirectoryEnumerator(maxN = 9999) {
  let index = 0;  
  while(index <= maxN) {
    const profileDirName = index ? `Profile ${index}` : `Default`;
    yield profileDirName;
  }
}
*/
