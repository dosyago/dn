import hasha from 'hasha';
import {URL} from 'url';
import path from 'path';
import fs from 'fs';
import args from './args.js';
import {APP_ROOT, context, sleep, DEBUG} from './common.js';
import {connect} from './protocol.js';

//import xapian from 'xapian';

// cache is a simple map
  // that holds the serialized requests
  // that are saved on disk
let Fs, Mode, Close;
const Cache = new Map();
const State = {
  Cache, 
  SavedCacheFilePath: null,
  SavedIndexFilePath: null,
  saver: null,
  indexSaver: null
}

const IGNORE_NODES = new Set([
  'script',
  'style',
  'noscript',
  'datalist'
]);
const TextNode = 3;
const AttributeNode = 2;

const Archivist = { 
  collect, getMode, changeMode, shutdown, handlePathChanged
}

const BODYLESS = new Set([
  301,
  302,
  303,
  307
]);
const NEVER_CACHE = new Set([
  `http://localhost:${args.server_port}`,
  `http://localhost:${args.chrome_port}`
]);
const SORT_URLS = ([urlA],[urlB]) => urlA < urlB ? -1 : 1;
const CACHE_FILE = args.cache_file; 
const INDEX_FILE = args.index_file;
const NO_FILE = args.no_file;
const TBL = /:\/\//g;
const HASH_OPTS = {algorithm: 'sha1'};
const UNCACHED_BODY = b64('We have not saved this data');
const UNCACHED_CODE = 404;
const UNCACHED_HEADERS = [
  { name: 'Content-type', value: 'text/plain' },
  { name: 'Content-length', value: '26' }
];
const UNCACHED = {
  body:UNCACHED_BODY, responseCode:UNCACHED_CODE, responseHeaders:UNCACHED_HEADERS
}

const InjectionSource = fs.readFileSync(path.resolve(APP_ROOT, 'injections', 'source.js'), "utf-8").toString("utf-8");

export default Archivist;

async function collect({chrome_port:port, mode} = {}) {
  if ( context == 'node' ) {
    const {default:fs} = await import('fs');
    Fs = fs;
  }
  const {library_path} = args;
  const {send, on, close} = await connect({port});
  const Sessions = new Map();
  const Installations = new Set();
  Close = close;
  Mode = mode; 

  // send commands and listen to events
    // so that we can intercept every request
    // and cache it and if it's in cache then we
    // can pause the request (so it does not go to network)
    // and serve from cache
    // effectively off-lining the site

  // question
    // can we attach to browser target and catch everything
    // or do we need to handle sessions ? 

  let requestStage;
  
  loadFiles();

  clearSavers();

  if ( Mode == 'save' ) {
    requestStage = "Response";
    // in case we get a updateBasePath call before an interval
    // and we don't clear it in time, leading us to erroneously save the old
    // cache to the new path, we always used our saved copy
    State.saver = setInterval(() => saveCache(State.SavedCacheFilePath), 10000);
    State.indexSaver = setInterval(() => saveIndex(State.SavedIndexFilePath), 10001);
  } else if ( Mode == 'serve' ) {
    requestStage = "Request";
  } else {
    throw new TypeError(`Must specify mode`);
  }

  send("Target.setDiscoverTargets", {discover:true});
  send("Target.setAutoAttach", {autoAttach:true, waitForDebuggerOnStart:true, flatten: true});

  send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "http*://*", 
        requestStage
      }
    ]
  });

  on("Fetch.requestPaused", cacheRequest);

  on("Target.targetInfoChanged", indexURL);
  on("Target.attachedToTarget", guard(installForSession, 'attached'));

  function guard(func, text = '') {
    return (...args) => {
      if ( args[0].waitingForDebugger ) {
        send("Runtime.runIfWaitingForDebugger", {}, args[0].sessionId);
        send("Runtime.enable", {}, args[0].sessionId);
      }

      if ( args[0].targetInfo.type !== 'page' ) return;

      console.log({text, func:func.name, args:JSON.stringify(args,null,2)});

      return func(...args);
    };
  }

  async function installForSession({sessionId, targetInfo, waitingForDebugger}) {
    if ( ! Installations.has(targetInfo.targetId) ) {

      if ( sessionId ) {
        Sessions.set(targetInfo.targetId, sessionId);
      } else {
        sessionId = Sessions.get(targetInfo.targetId);
      }

      if ( sessionId ) {

        send("DOM.enable", {}, sessionId);
        send("Page.enable", {}, sessionId);
        send("Page.addScriptToEvaluateOnNewDocument", {
          source: InjectionSource,
          worldName: "Context-22120-Indexing"
        }, sessionId);

        Installations.add(targetInfo.targetId);

        indexURL({targetInfo});

      }

    }
  }

  async function indexURL({targetInfo:info = {}} = {}) {
    DEBUG && console.log({indexURL:JSON.stringify(info,null,2)});
    if ( info.type != 'page' ) return;
    if ( ! info.url  || info.url == 'about:blank' ) return;
    if ( info.url.startsWith('chrome') ) return;
    if ( dontCache(info) ) return;

    State.Index.set(info.url, info.title);   

    if ( Installations.has(info.targetId) ) {

      await sleep(1000);

      const sessionId = Sessions.get(info.targetId);
      const {nodes:pageNodes} = await send("DOM.getFlattenedDocument", {
        depth: -1,
        pierce: true
      }, sessionId);
      // we collect TextNodes, ignoring any under script, style or an attribute
      const ignoredParentIds = new Set(
        pageNodes.filter(
          ({localName,nodeType}) => IGNORE_NODES.has(localName) || nodeType == AttributeNode
        ).map(({nodeId}) => nodeId)
      );
      const pageText = pageNodes.filter(
        ({nodeType,parentId}) => nodeType == TextNode && ! ignoredParentIds.has(parentId)
      ).reduce(
        (Text, {nodeValue}) => Text + nodeValue + ' ',
        ''
      );
      console.log({
        page : {
          url: info.url,
          title: info.title,
          text: pageText
        }
      });

    }

    DEBUG && console.log(`Indexing ${info.url} to ${info.title}`);
  }

  async function attachToTarget({targetInfo}) {
    return;
    if ( dontCache(targetInfo) ) return;

    if ( targetInfo.type == 'page' && ! targetInfo.attached ) {
      const {sessionId} = await send("Target.attachToTarget", {
        targetId: targetInfo.targetId,
        flatten: true
      });
      Sessions.set(targetInfo.targetId, sessionId);
      indexURL({targetInfo});
    }
  }


  async function cacheRequest(pausedRequest) {
    const {requestId, request, resourceType, responseStatusCode, responseHeaders} = pausedRequest;
    if ( dontCache(request) ) {
      DEBUG && console.log("Not caching", request.url);
      return send("Fetch.continueRequest", {requestId});
    }
    const key = serializeRequest(request);
    if ( Mode == 'serve' ) {
      if ( State.Cache.has(key) ) {
        let {body, responseCode, responseHeaders} = await getResponseData(State.Cache.get(key));
        responseCode = responseCode || 200;
        //DEBUG && console.log("Fulfilling", key, responseCode, responseHeaders, body.slice(0,140));
        DEBUG && console.log("Fulfilling", key, responseCode, body.slice(0,140));
        await send("Fetch.fulfillRequest", {
          requestId, body, responseCode, responseHeaders
        });
      } else {
        DEBUG && console.log("Sending cache stub", key);
        await send("Fetch.fulfillRequest", {
          requestId, ...UNCACHED
        });
      } 
    } else if ( Mode == 'save' ) {
      const response = {key, responseCode: responseStatusCode, responseHeaders};
      let resp;
      if ( ! BODYLESS.has(responseStatusCode) ) {
        resp = await send("Fetch.getResponseBody", {requestId});
      } else {
        resp = {body:'', base64Encoded:true};
      }
      if ( ! resp ) {
        DEBUG && console.warn("get response body error", key, responseStatusCode, responseHeaders, pausedRequest.responseErrorReason);  
        return send("Fetch.continueRequest", {requestId});
      }
      if ( !! resp ) {
        let {body, base64Encoded} = resp;
        if ( ! base64Encoded ) {
          body = b64(body);
        }
        response.body = body;
      } else {
        response.body = '';
      }
      const responsePath = await saveResponseData(key, request.url, response);
      State.Cache.set(key, responsePath);
      await send("Fetch.continueRequest", {requestId});
    }
  }
  
  function dontCache(request) {
    if ( ! request.url ) return false;
    const url = new URL(request.url);
    return NEVER_CACHE.has(url.origin) || (State.No && State.No.test(url.host));
  }

  async function getResponseData(path) {
    try {
      return JSON.parse(await Fs.promises.readFile(path));
    } catch(e) {
      console.warn(`Error with ${path}`, e);
      return UNCACHED;
    }
  }

  async function saveResponseData(key, url, response) {
    const origin = (new URL(url).origin);
    let originDir = State.Cache.get(origin);
    if ( ! originDir ) {
      originDir = path.resolve(library_path(), origin.replace(TBL, '_'));
      try {
        await Fs.promises.mkdir(originDir, {recursive:true});
      } catch(e) {
        console.warn(`Issue with origin directory ${path.dirname(responsePath)}`, e);
      }
      State.Cache.set(origin, originDir);
    }

    const fileName = `${await hasha(key, HASH_OPTS)}.json`;

    const responsePath = path.resolve(originDir, fileName);
    await Fs.promises.writeFile(responsePath, JSON.stringify(response));

    return responsePath;
  }

  function serializeRequest(request) {
    const {url, urlFragment, method, headers, postData, hasPostData} = request;

    /**
    let sortedHeaders = '';
    for( const key of Object.keys(headers).sort() ) {
      sortedHeaders += `${key}:${headers[key]}/`;
    }
    **/

    return `${method}${url}`;
    //return `${url}${urlFragment}:${method}:${sortedHeaders}:${postData}:${hasPostData}`;
  }
}

function clearSavers() {
  if ( State.saver ) {
    clearInterval(State.saver);
    State.saver = null;
  }

  if ( State.indexSaver ) {
    clearInterval(State.indexSaver);
    State.indexSaver = null;
  }
}

function loadFiles() {
  try {
    State.Cache = new Map(JSON.parse(Fs.readFileSync(CACHE_FILE())));
    State.Index = new Map(JSON.parse(Fs.readFileSync(INDEX_FILE())));
    State.SavedCacheFilePath = CACHE_FILE();
    State.SavedIndexFilePath = INDEX_FILE();
    DEBUG && console.log(`Loaded cache key file ${CACHE_FILE()}`);
    DEBUG && console.log(`Loaded index file ${INDEX_FILE()}`);
  } catch(e) {
    DEBUG && console.warn('Error reading file', e);
    State.Cache = new Map();
    State.Index = new Map();
  }

  try {
    if ( !Fs.existsSync(NO_FILE()) ) {
      DEBUG && console.log(`The 'No file' (${NO_FILE()}) does not exist, ignoring...`); 
      State.No = null;
    } else {
      State.No = new RegExp(JSON.parse(Fs.readFileSync(NO_FILE))
        .join('|')
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.?')
      );
    }
  } catch(e) {
    DEBUG && console.warn('Error compiling regex from No file', e);
    State.No = null;
  }
}

function getMode() { return Mode; }

async function changeMode(mode) { 
  DEBUG && console.log({modeChange:mode});
  clearSavers();
  saveCache();
  saveIndex();
  Close && Close();
  Mode = mode;
  await collect({chrome_port:args.chrome_port, mode});
}

function handlePathChanged() { 
  DEBUG && console.log({libraryPathChange:args.library_path()});
  clearSavers();
  // saves the old cache path
  saveCache(State.SavedCacheFilePath);
  saveIndex(State.SavedIndexFilePath);
  // reloads from new path and updates Saved FilePaths
  loadFiles();
}

function saveCache(path) {
  if ( context == 'node' ) {
    //DEBUG && console.log("Writing to", path || CACHE_FILE());
    Fs.writeFileSync(path || CACHE_FILE(), JSON.stringify([...State.Cache.entries()]));
  }
}

function saveIndex(path) {
  if ( context == 'node' ) {
    //DEBUG && console.log("Writing to", path || INDEX_FILE());
    //DEBUG && console.log([...State.Index.entries()].sort(SORT_URLS));
    Fs.writeFileSync(path || INDEX_FILE(), JSON.stringify([...State.Index.entries()].sort(SORT_URLS)));
  }
}

function shutdown() {
  DEBUG && console.log(`Archivist shutting down...`);  
  saveCache();
  Close && Close();
  DEBUG && console.log(`Archivist shut down.`);
}

function b64(s) {
  if ( context == 'node' ) {
    return Buffer.from(s).toString('base64');
  } else {
    return btoa(s);
  }
}


