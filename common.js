import path from 'path';
import {fileURLToPath} from 'url';

// determine where this code is running 
  let Context = 'unknown';

  // ignore the possibility that window or global or chrome could be overwritten
  const isBrowser = function () { try {return window && window.fetch;}catch(e){ return false;} };
  const isNode = function () { try {return global && global.Math;}catch(e){return false;} };
  const isExtension = function () { try {return chrome.runtime && chrome.debugger;}catch(e){return false;} };

  if ( isNode() ) {
    Context = 'node';
  } else if ( isBrowser() ) {
    Context = 'browser';
    if ( isExtension() ) {
      Context = 'extension';
    }
  }

export const context = Context;

export const DEBUG = process.env.DEBUG_22120 || false;

export const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));

export const sleep = ms => new Promise(res => setTimeout(res, ms));

export function say(o) {
  console.log(JSON.stringify(o));
}
