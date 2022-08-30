#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';

const CLEAN = false;
const CONCURRENT = 7;
const sleep = ms => new Promise(res => setTimeout(res, ms));
const entries = [];
const counted = new Set();
const errors = new Map();
let counts;
let cleaning = false;

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGHUP', cleanup);
process.on('SIGUSR2', cleanup);
process.on('beforeExit', cleanup);

make();

async function make() {
  const titlesFile = fs.readFileSync(path.resolve('.', 'topTitles.json')).toString();
  const titles = new Map(JSON.parse(titlesFile).map(([url, title]) => [url, {url,title}]));
  if ( CLEAN ) {
    for ( const [url, obj] of titles ) {
      const k1 = clean(url);
      const k2 = clean2(url);
      if ( !titles.has(k1) ) {
        titles.set(k1, obj);
      }
      if ( !titles.has(k2) ) {
        titles.set(k2, obj);
      }
    }
  }
  const remainingFile =  fs.readFileSync(path.resolve('.', 'remainingFile.json')).toString();
  const remainingSet = new Set(JSON.parse(remainingFile));
  const countsFile = fs.readFileSync(path.resolve('.', 'ran-counts.json')).toString();
  counts = new Map(JSON.parse(countsFile).filter(([url, count]) => remainingSet.has(url)));
  let current = 0;
  for ( const [url, count] of counts ) {
    let title;
    let realUrl;
    if ( titles.has(url) ) {
      ({title} = titles.get(url));
      entries.push({
        url, 
        title, 
        count,
      });
      counted.add(url);
    } else {
      console.log(`Curl call for ${url} in progress...`);
      let notifyCurlComplete;
      const curlCall = new Promise(res => notifyCurlComplete = res);
      do {
        await sleep(1000);
      } while ( current >= CONCURRENT );
      child_process.exec(curlCommand(url), (err, stdout, stderr) => {
        if ( ! err && (!stderr || stderr.length == 0)) {
          realUrl = stdout; 
          if ( titles.has(realUrl) ) {
            ({title} = titles.get(realUrl));
            entries.push({
              url, 
              realUrl,
              title, 
              count,
            });
            counted.add(url);
          }
        } else {
          console.log(`Error on curl for ${url}`, {err, stderr});
          errors.set(url, {err, stderr});
        }
        console.log(`Curl call for ${url} complete!`);
        notifyCurlComplete();
      });
      current += 1;
      curlCall.then(() => current -= 1);
    }
  }
  cleanup();
}

async function make_v2() {
  const titlesFile = fs.readFileSync(path.resolve('.', 'topTitles.json')).toString();
  const titles = new Map(JSON.parse(titlesFile).map(([url, title]) => [url, {url,title}]));
  if ( CLEAN ) {
    for ( const [url, obj] of titles ) {
      const k1 = clean(url);
      const k2 = clean2(url);
      if ( !titles.has(k1) ) {
        titles.set(k1, obj);
      }
      if ( !titles.has(k2) ) {
        titles.set(k2, obj);
      }
    }
  }
  const countsFile = fs.readFileSync(path.resolve('.', 'ran-counts.json')).toString();
  counts = new Map(JSON.parse(countsFile));
  let current = 0;
  for ( const [url, count] of counts ) {
    let title;
    let realUrl;
    if ( titles.has(url) ) {
      ({title} = titles.get(url));
      entries.push({
        url, 
        title, 
        count,
      });
      counted.add(url);
    } else {
      console.log(`Curl call for ${url} in progress...`);
      let notifyCurlComplete;
      const curlCall = new Promise(res => notifyCurlComplete = res);
      do {
        await sleep(250);
      } while ( current >= CONCURRENT );
      child_process.exec(curlCommand(url), (err, stdout, stderr) => {
        if ( ! err && (!stderr || stderr.length == 0)) {
          realUrl = stdout; 
          if ( titles.has(realUrl) ) {
            ({title} = titles.get(realUrl));
            entries.push({
              url, 
              realUrl,
              title, 
              count,
            });
            counted.add(url);
          }
        } else {
          console.log(`Error on curl for ${url}`, {err, stderr});
          errors.set(url, {err, stderr});
        }
        console.log(`Curl call for ${url} complete!`);
        notifyCurlComplete();
      });
      current += 1;
      curlCall.then(() => current -= 1);
    }
  }
  cleanup();
}

function cleanup() {
  if ( cleaning ) return;
  cleaning = true;
  console.log('cleanup running');
  if ( errors.size ) {
    fs.writeFileSync(
      path.resolve('.', 'errorLinks4.json'),
      JSON.stringify([...errors.keys()], null, 2)
    );
    console.log(`Wrote errors`);
  }
  if ( counted.size !== counts.size ) {
    counted.forEach(url => counts.delete(url)); 
    fs.writeFileSync(
      path.resolve('.', 'noTitleFound4.json'),
      JSON.stringify([...counts.keys()], null, 2)
    )
    console.log(`Wrote noTitleFound`);
  }
  fs.writeFileSync(
    path.resolve('.', 'topFrontPageLinksWithCounts4.json'), 
    JSON.stringify(entries, null, 2)
  );
  console.log(`Wrote top links with counts`);
  process.exit(0);
}

async function make_v1() {
  const titlesFile = fs.readFileSync(path.resolve('.', 'topTitles.json')).toString();
  const titles = new Map(JSON.parse(titlesFile).map(([url, title]) => [clean(url), {url,title}]));
  const countsFile = fs.readFileSync(path.resolve('.', 'counts.json')).toString();
  const counts = new Map(JSON.parse(countsFile).map(([url, count]) => [clean(url), count]));
  for ( const [key, count] of counts ) {
    counts.set(clean2(key), count);
  }
  const entries = [];
  for ( const [key, {url,title}] of titles ) {
    entries.push({
      url, title, 
      count: counts.get(key) || 
        counts.get(url) || 
        counts.get(clean2(key)) || 
        console.log(`No count found for`, {key, url, title, c2key: clean2(key)})
    });
  }
  fs.writeFileSync(
    path.resolve('.', 'topFrontPageLinks.json'), 
    JSON.stringify(entries, null, 2)
  );
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
