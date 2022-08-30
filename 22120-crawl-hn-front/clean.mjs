#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import stream from 'stream';
import path from 'path';

//console.log(`Using node ${process.version}`);

if ( ! process.argv[2] ) {
  console.warn(`Need to supply a file of URLs to clean`);
  process.exit(1)
}

const SHOW = false;
const box = new Map();
const input = fs.createReadStream(path.resolve(process.argv[2]));
const output = new stream;
const oTime = Date.now();

let max = -Infinity;
let lines = 0;

const lineReader = new readline.createInterface({
  input, output,
  terminal: false
});

lineReader.on('line', line => {
  lines++;
  const [realCount, uri] = line.trim().split(/\s/g);
  const url = new URL(uri ? uri : realCount);
  let oProtocol = [url.protocol];
  let count = uri ? parseInt(realCount) : 1;
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
  const adr = url.toString();
  url.protocol = 'https:';
  url.pathname = url.pathname.replace(/\.htm.?$/, '');
  const key = url.toString();
  if ( box.has(key) ) {
    const {oProtocol:op2,count:count2} = box.get(key);
    oProtocol = [op2, ...oProtocol];
    count += count2;
    if ( count > max ) {
      max = count;
      //console.log(`New leader: ${key} with count: ${count}`, line);
    }
  } else if ( uri ) {
    count -= 1;
  }
  box.set(key, {oProtocol,count,adr});
});

lineReader.on('close', () => {
  const time = Date.now() - oTime;
  console.log(`Done ${lines} lines in ${time}ms`);
  const list = [...box.entries()].sort(([k1,{count:c1}], [k2,{count:c2}]) => c2 - c1).map(([k,{adr,count,oProtocol}]) => {
    //((adr !== k && count > 1 ? SHOW && console.log('found a html case', adr) : void 0), `${count} ${adr !== k ? adr : k}`))
    const u = new URL(adr !== k ? adr : k );
    if ( oProtocol.includes('https:') ) {
      u.protocol = 'https:';
    }
    return `${count} ${u}`;
  });
  console.log(list.join('\n'));
});

