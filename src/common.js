import path from 'path';
import {fileURLToPath} from 'url';

export const DEBUG = process.env.DEBUG_22120 || false;
export const SHOW_FETCH = false;

export const CHECK_INTERVAL = 400;
export const TEXT_NODE = 3;
export const MAX_HIGHLIGHTABLE_LENGTH = 0;    /* 0 is no max length for highlight */
export const MAX_TITLE_LENGTH = 140;
export const MAX_URL_LENGTH = 140;
export const MAX_REAL_URL_LENGTH = 2**15 - 1;
export const MAX_HEAD = 140;

export class RichError extends Error {
  constructor(msg) {
    let textMessage;
    try {
      textMessage = JSON.stringify(msg);
    } catch(e) {
      console.warn(`Could not create RichError from argument ${msg.toString ? msg.toString() : msg} as JSON serialization failed. RichError argument MUST be JSON serializable. Failure error was:`, e);
      return;
    }
    super(textMessage);
  }
}

/* text nodes inside these elements that are ignored */
export const FORBIDDEN_TEXT_PARENT = new Set([
  'STYLE',
  'SCRIPT',
  'NOSCRIPT',
  /* we could remove these last two so as to index them as well */
  'DATALIST',
  'OPTION'
]);
export const ERROR_CODE_SAFE_TO_IGNORE = new Set([
  -32000, /* message:
            Can only get response body on requests captured after headers received.
           * ignore because: 
              seems to only happen when new navigation aborts all 
              pending requests of the unloading page 
           */
  -32602, /* message:
            Invalid InterceptionId.
           * ignore because: 
              seems to only happen when new navigation aborts all 
              pending requests of the unloading page 
           */
]);

export const SNIP_CONTEXT = 31;

export const NO_SANDBOX = process.env.DEBUG_22120 || false;

//export const APP_ROOT = '.';
//export const APP_ROOT = __dirname;
export const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));

export const sleep = ms => new Promise(res => setTimeout(res, ms));

export function say(o) {
  console.log(JSON.stringify(o));
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
