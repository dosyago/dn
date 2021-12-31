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
const BOOKMARK_FILE_NAME_REGEX = /^(Bookmark|Bookmark.bak)/i;
const isBookmarkFile = name => BOOKMARK_FILE_NAME_REGEX.test(name);

test();
async function test() {
  for await ( const event of bookmarkChanges() ) {
    console.log({event});
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

/*
function* profileDirectoryEnumerator(maxN = 9999) {
  let index = 0;  
  while(index <= maxN) {
    const profileDirName = index ? `Profile ${index}` : `Default`;
    yield profileDirName;
  }
}
*/
