import os from 'os';
import Path from 'path';
import fs from 'fs';
import {watch} from 'chokidar';

import {DEBUG as debug} from './common.js';

const DEBUG = debug || false;
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

export async function* bookmarkChanges() {
  // try to get the profile directory
    const rootDir = getProfileRootDir();

    if ( !fs.existsSync(rootDir) ) {
      throw new TypeError(`Sorry! The directory where we thought the Chrome profile directories may be found (${rootDir}), does not exist. We can't monitor changes to your bookmarks, so Bookmark Select Mode is not supported.`);
    }

  // state constants and variables (including chokidar file glob observer)
    const bookmarkWatchGlobs = [
      Path.resolve(rootDir, '**', 'Book*'), 
      Path.resolve(rootDir, '**', 'book*')
    ];
    const observer = watch(bookmarkWatchGlobs, CHOK_OPTS);
    const ps = [];
    let change = false;
    let publish = false;
    let notifyChange = false;
    let shuttingDown = false;
    let stopLooping = false;

  // listen for all events from the observer
    observer.on('ready', () => {
      DEBUG && console.log(`Ready to watch`);
      // only publish changes, ie, events after the initial scan
      publish = true;
    });
    observer.on('all', (event, path) => {
      // listen to everything
      const name = Path.basename(path);
      if ( isBookmarkFile(name) ) {
        // but only act if it is a bookmark file
        DEBUG && console.log(event, path, notifyChange);
        // save the event type and file it happened to
        change = {event, path};
        // drop the most recently pushed promise from our bookkeeping list
        ps.pop();
        // resolve the promise in the wait loop to process the bookmark file and emit the changes
        notifyChange && notifyChange();
      }
    });
    observer.on('error', error => {
      console.warn(`Bookmark file watcher error`, error);
    });

  // make sure we kill the watcher on process restart or shutdown
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);
    process.on('SIGINT',  shutdown);
    process.on('SIGBRK', shutdown);

  // the main wait loop that enables us to turn a traditional NodeJS eventemitter
  // into an asychronous stream generator
  waiting: while(true) {
    // Note: code resilience
      //the below two statements can come in any order in this loop, both work

    // get, process and publish changes
      // only do if the change is there (first time it won't be because
      // we haven't yielded out (async or yield) yet)
      if ( change && !change.path.endsWith('bak') ) {
        const {path:file} = change;
        change = false;

        const data = fs.readFileSync(file);
        const jData = JSON.parse(data);
        const changes = flatten(jData, {toMap:true, map: State.books});

        if ( publish ) {
          for( const changeEvent of changes ) yield changeEvent;
        }
      }

    // wait for the next change
      // always wait tho (to allow queueing of the next event to process)
      try {
        await new Promise((res, rej) => {
          // save these
          notifyChange = res;   // so we can turn the next turn of the loop
          stopLooping = rej;    // so we can break out of the loop (on shutdown)
          ps.push({res,rej});   // so we can clean up any left over promises
        });
      } catch { 
        ps.pop();
        break waiting; 
      }
  }

  // clean up any outstanding waiting promises
    if ( ps.length ) {
      console.info(`Cleaning up some outstanding waiting promises...`);
      ps.forEach(({rej}) => {
        /* eslint-disable no-empty */
        try { rej(); } finally {}
        /* eslint-enable no-empty */
      });
    }

  async function shutdown() {
    if ( shuttingDown ) return;
    shuttingDown = true;
    console.log('Bookmark observer shutting down...');
    observer.unwatch(bookmarkWatchGlobs);
    stopLooping && setTimeout(() => stopLooping('bookmark watching stopped'), 0);
    await observer.close();
    console.log('Bookmark observer shut down cleanly.');
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
                if ( !urlSet.has(url) ) {
                  changes.push({
                    type: "Title updated",
                    url,
                    oldName, 
                    name
                  });
                }
              }
            } else {
              changes.push({
                type: "new",
                name, url
              });
            }
          } 
          if ( !urlSet.has(url) ) {
            urls.set(url, next);
          }
          urlSet.add(url);
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
test();
async function test() {
  for await ( const change of bookmarkChanges() ) {
    console.log(change);
  }
}
*/


/*
function* profileDirectoryEnumerator(maxN = 9999) {
  let index = 0;  
  while(index <= maxN) {
    const profileDirName = index ? `Profile ${index}` : `Default`;
    yield profileDirName;
  }
}
*/
