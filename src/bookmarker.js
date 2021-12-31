import os from 'os';
import fs from 'fs';
import chokidar from 'chokidar';

// Chrome user data directories by platform. 
  // Source 1: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/user_data_dir.md 
  // Source 2: https://superuser.com/questions/329112/where-are-the-user-profile-directories-of-google-chrome-located-in

// Note:
  // Not all the below are now used or supported by this code
const UDD_PATHS = {
  'win': '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
  'winxp' : '%USERPROFILE%\\Local Settings\\Application Data\\Google\\Chrome\\User Data',
  'macos' : '~/Library/Application Support/Google/Chrome',
  'nix' : '~/.config/google-chrome',
  'chromeos': '/home/chronos',                        /* no support */
  'ios': 'Library/Application Support/Google/Chrome', /* no support */
};
const PLAT_TABLE = {
  'darwin': 'macos',
  'linux': 'nix'
};
const PROFILE_REGEX = /^(Default|Profile \d+)$/i;
const isProfile = name => PROFILE_REGEX.test(name);

findDefaultChromeProfile();

function findDefaultChromeProfile() {
  const rootDir = getProfileRootDir();

  if ( !fs.existsSync(rootDir) ) {
    throw new TypeError(`Sorry! The directory where we thought the Chrome profile directories may be found (${rootDir}), does not exist. We can't monitor changes to your bookmarks, so Bookmark Select Mode is not supported.`);
  }

  const bookmarkWatchGlob = path.resolve(rootDir, '**', 'book*');
}

function getProfileRootDir() {
  const plat = os.platform();
  let name = PLAT_TABLE[plat];
  let rootDir;

  if ( !name && plat === 'win32' ) {
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

  if ( UDD_PATHS[name] ) {
    rootDir = path.resolve(UDD_PATHS[name]);
  } else {
    throw new TypeError(
      `Sorry! We don't know how to find the default Chrome profile on OS name: ${name}`
    );
  }

  return rootDir;
}

function* profileDirectoryEnumerator(maxN = 9999) {
  let index = 0;  
  while(index <= maxN) {
    const profileDirName = index ? `Profile ${index}` : `Default`;
    yield profileDirName;
  }
}
