#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';

import {
  loadPref,
  cache_file,
  index_file,
} from '../src/args.js';

const CLEAN = true;
const CONCURRENT = 7;
const sleep = ms => new Promise(res => setTimeout(res, ms));
const problems = new Map();
let cleaning = false;
let made = false;

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGHUP', cleanup);
process.on('SIGUSR2', cleanup);
process.on('beforeExit', cleanup);

console.log({Pref:loadPref(), cache_file: cache_file(), index_file: index_file()});
make();

async function make() {
  const indexFile = fs.readFileSync(index_file()).toString();
  JSON.parse(indexFile).map(([key, value]) => {
    if ( typeof key === "number" ) return;
    if ( key.startsWith('ndx') ) return;
    if ( value.title === undefined ) {
      console.log('no title property', {key, value});
    }
    const url = key;
    const title = value.title.toLocaleLowerCase();
    if ( title.length === 0 || title.includes('404') || title.includes('not found') ) {
      if ( problems.has(url) ) {
        console.log('Found duplicate', url, title, problems.get(url));
      }
      const prob = {title, dupes:[], dupe:false};
      problems.set(url, prob);
      const cleaned1 = clean(url);
      if ( problems.has(cleaned1) ) {
        console.log(`Found duplicate`, {url, title, cleaned1, dupeEntry:problems.get(cleaned1)});
        prob.dupe = true;
        prob.dupes.push(cleaned1);
        problems.delete(cleaned1);
      }
      const cleaned2 = clean2(url);
      if ( problems.has(cleaned2) ) {
        console.log(`Found duplicate`, {url, title, cleaned2, dupeEntry: problems.get(cleaned2)});
        prob.dupe = true;
        prob.dupes.push(cleaned2);
        problems.delete(cleaned2);
      }
    }
  });

  made = true;

  cleanup();
}

function cleanup() {
  if ( cleaning ) return;
  if ( ! made ) return;
  cleaning = true;
  console.log('cleanup running');
  const outData = [...problems.entries()].filter(([key, {dupe}]) => dupe);
  fs.writeFileSync(
    path.resolve('.', 'url-cleaned-dupes.json'), 
    JSON.stringify(outData, null, 2)
  );
  const {size:bytesWritten} = fs.statSync(
    path.resolve('.', 'url-cleaned-dupes.json'), 
    {bigint: true}
  );
  console.log(`Wrote ${outData.length} dupe urls in ${bytesWritten} bytes.`);
  process.exit(0);
}

function clean(urlString) {
  const url = new URL(urlString);
  if ( url.hash.startsWith('#!') || url.hostname.includes('google.com') || url.hostname.includes('80s.nyc') ) {
  } else {
    url.hash = '';
  }
  for ( const [key, value] of url.searchParams ) {
    if ( key.startsWith('utm_') ) {
      url.searchParams.delete(key);
    }
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.protocol = 'https:';
  url.pathname = url.pathname.replace(/(\.htm.?|\.php)$/, '');
  if ( url.hostname.startsWith('www.') ) {
    url.hostname = url.hostname.replace(/^www./, '');
  }
  const key = url.toString();
  return key;
}

function clean2(urlString) {
  const url = new URL(urlString);
  url.pathname = ''; 
  return url.toString();
}

function curlCommand(url) {
  return `curl -k -L -s -o /dev/null -w '%{url_effective}' ${JSON.stringify(url)} \
    -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9' \
    -H 'Accept-Language: en,en-US;q=0.9,zh-TW;q=0.8,zh-CN;q=0.7,zh;q=0.6,ja;q=0.5' \
    -H 'Cache-Control: no-cache' \
    -H 'Connection: keep-alive' \
    -H 'DNT: 1' \
    -H 'Pragma: no-cache' \
    -H 'Sec-Fetch-Dest: document' \
    -H 'Sec-Fetch-Mode: navigate' \
    -H 'Sec-Fetch-Site: none' \
    -H 'Sec-Fetch-User: ?1' \
    -H 'Upgrade-Insecure-Requests: 1' \
    -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36' \
    -H 'sec-ch-ua: "Chromium";v="104", " Not A;Brand";v="99", "Google Chrome";v="104"' \
    -H 'sec-ch-ua-mobile: ?0' \
    -H 'sec-ch-ua-platform: "macOS"' \
    --compressed ;
  `;
}
