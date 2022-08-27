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
  url.protocol = 'https:';
  if ( url.hash.startsWith('#!') || url.hostname.includes('google.com') || url.hostname.includes('80s.nyc') ) {
  } else {
    url.hash = '';
  }
  if ( url.searchParams.has('utm_source') ) {
    url.search = '';
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  const adr = url.toString();
  url.pathname = url.pathname.replace(/\.html$/, '');
  const key = url.toString();
  const burl = new URL(url);
  burl.pathname += '.html';
  if ( box.has(burl.toString()) ) {
    //console.log(`Found a real html case`, key);
  }
  if ( box.has(key) ) {
    const {oProtocol:op2,count:count2} = box.get(key);
    oProtocol = [op2, ...oProtocol];
    count += count2;
    if ( count > max ) {
      max = count;
      //console.log(`New leader: ${key} with count: ${count}`, line);
    }
  }
  box.set(key, {oProtocol,count,adr});
});

lineReader.on('close', () => {
  const time = Date.now() - oTime;
  console.log(`Done ${lines} lines in ${time}ms`);
  /*
    console.log(`Top 100 links by count`);
    const list = [...box.entries()].sort(([k1,{count:c1}], [k2,{count:c2}]) => c2 - c1).map(([k,{adr,count}]) => (adr !== k ? SHOW && console.log('found a html case', adr) : void 0), `${count} ${adr !== k ? adr : k}`))
    console.log(list.slice(0,100).join('\n'));
  */
  const list = [...box.entries()].sort(([k1,{count:c1}], [k2,{count:c2}]) => c2 - c1).map(([k,{adr,count}]) => ((adr !== k && count > 1 ? SHOW && console.log('found a html case', adr) : void 0), `${count} ${adr !== k ? adr : k}`))
  console.log(list.join('\n'));
});




