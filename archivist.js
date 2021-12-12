import hasha from 'hasha';
import {URL} from 'url';
import path from 'path';
import fs from 'fs';
import FlexSearch from 'flexsearch';
import args from './args.js';
import {
  APP_ROOT, context, sleep, DEBUG, 
  CHECK_INTERVAL, TEXT_NODE, FORBIDDEN_TEXT_PARENT
} from './common.js';
import {connect} from './protocol.js';
import {getInjection} from './public/injection.js';
import {BLOCKED_BODY, BLOCKED_CODE, BLOCKED_HEADERS} from './blockedResponse.js';

//import xapian from 'xapian';

// cache is a simple map
  // that holds the serialized requests
  // that are saved on disk
let Fs, Mode, Close;
const {Index, registerCharset, registerLanguage} = FlexSearch;
const FLEX_OPTS = {
  context: true,
};
const Flex = new Index(FLEX_OPTS);
const Cache = new Map();
const Indexing = new Set();
const State = {
  Indexing,
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
  const ConfirmedInstalls = new Set();
  const DELAY = 100; // 500 ?
  Close = close;
  Mode = mode; 

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

  on("Target.targetInfoChanged", indexURL);
  on("Target.targetInfoChanged", reloadIfNotLive);

  on("Target.targetInfoChanged", attachToTarget);

  on("Target.attachedToTarget", installForSession);

  on("Fetch.requestPaused", cacheRequest);

  on("Runtime.consoleAPICalled", confirmInstall);

  await send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "http*://*", 
        requestStage
      }
    ], 
  });

  await send("Target.setDiscoverTargets", {discover:true});
  await send("Target.setAutoAttach", {autoAttach:true, waitForDebuggerOnStart:false, flatten: true});

  const {targetInfos:targets} = await send("Target.getTargets", {});
  const pageTargets = targets.filter(({type}) => type == 'page');
  pageTargets.forEach(attachToTarget);

  function guard(func, text = '') {
    return (...args) => {
      //DEBUG && console.log({text, func:func.name, args:JSON.stringify(args,null,2)});

      return func(...args);
    };
  }

  function confirmInstall(args) {
    const {type, args:[{value:strVal}], context} = args;
    if ( type == 'info' ) {
      try {
        const val = JSON.parse(strVal);
        const {installed:{sessionId}} = val;
        if ( ! ConfirmedInstalls.has(sessionId) ) {
          ConfirmedInstalls.add(sessionId);
          console.log({confirmedInstall:val, context});
        }
      } finally {} 
    }
  }

  async function reloadIfNotLive({targetInfo}) {
    if ( Mode == 'serve' ) return; 
    const {attached, type} = targetInfo;
    if ( attached && type == 'page' ) {
      const {url, targetId} = targetInfo;
      const sessionId = Sessions.get(targetId);
      if ( !!sessionId && !!url && url != "about:blank" && !url.startsWith('chrome') && !ConfirmedInstalls.has(sessionId) ) {
        console.log({reloadingAsNotConfirmedInstalled:{url, sessionId}});
        send("Page.stopLoading", {}, sessionId);
        send("Page.reload", {}, sessionId);
      }
    }
  }

  async function installForSession({sessionId, targetInfo, waitingForDebugger}) {
    console.log("installForSession called");
    if ( ! sessionId ) {
      throw new TypeError(`installForSession needs a sessionId`);
    }

    const {targetId, url} = targetInfo;

    if ( Installations.has(sessionId) ) return;

    if ( targetInfo.type != 'page' ) return;

    if ( Mode == 'serve' ) return;

    Sessions.set(targetId, sessionId);

    if ( Mode == 'save' ) {
      send("Network.setCacheDisabled", {cacheDisabled:true}, sessionId);
      send("Network.setBypassServiceWorker", {bypass:true}, sessionId);

      await send("Runtime.enable", {}, sessionId);
      await send("Page.enable", {}, sessionId);
      await send("DOMSnapshot.enable", {}, sessionId);

      await send("Page.addScriptToEvaluateOnNewDocument", {
        source: getInjection({sessionId}),
        worldName: "Context-22120-Indexing"
      }, sessionId);

      DEBUG && console.log("Just request install", targetId, url);
    }

    Installations.add(sessionId);

    console.log('Installed sessionId', sessionId);
    indexURL({targetInfo});
  }

  async function indexURL({targetInfo:info = {}, sessionId, waitingForDebugger} = {}) {
    if ( Mode == 'serve' ) return;
    if ( info.type != 'page' ) return;
    if ( ! info.url  || info.url == 'about:blank' ) return;
    if ( info.url.startsWith('chrome') ) return;
    if ( dontCache(info) ) return;

    if ( State.Indexing.has(info.targetId) ) return;
    State.Indexing.add(info.targetId);

    State.Index.set(info.url, info.title);   

    if ( ! sessionId ) {
      sessionId = await untilHas(Sessions, info.targetId);
    }

    if ( !Installations.has(sessionId) ) {
      await untilHas(Installations, sessionId);
    }

    console.log('hi', sessionId);

    send("DOMSnapshot.enable", {}, sessionId);

    await sleep(500);

    const flatDoc = await send("DOMSnapshot.captureSnapshot", {
      computedStyles: [],
    }, sessionId);
    const pageText = processDoc(flatDoc);
    //Flex.updateAsync(info.url, pageText).then(r => console.log('Search index update done'));
    //Flex.addAsync(info.url, pageText).then(r => console.log('Search index update done'));
    const res = Flex.add(info.url, pageText);
    DEBUG && console.log('Flex Index Result>>>', res);

    State.Indexing.delete(info.targetId);

    console.log(`Indexed ${info.url} to ${info.title}`);
  }

  async function untilHas(thing, key) {
    if ( thing instanceof Map ) {
      if ( thing.has(key) ) {
        return thing.get(key);
      } else {
        let resolve;
        const pr = new Promise(res => resolve = res);
        const checker = setInterval(() => {
          if ( thing.has(key) ) {
            clearInterval(checker);
            resolve(thing.get(key));
          } else {
            console.log(thing, "not have", key);
          }
        }, CHECK_INTERVAL);

        return pr;
      }
    } else if ( thing instanceof Set ) {
      if ( thing.has(key) ) {
        return true;
      } else {
        let resolve;
        const pr = new Promise(res => resolve = res);
        const checker = setInterval(() => {
          if ( thing.has(key) ) {
            clearInterval(checker);
            resolve(true);
          } else {
            console.log(thing, "not have", key);
          }
        }, CHECK_INTERVAL);

        return pr;
      }
    } else {
      throw new TypeError(`untilHas with thing of type ${thing} is not yet implemented!`);
    }
  }

  function processDoc({documents, strings}) {
    /* 
      Info
      Implementation Notes 

      1. Code uses spec at: 
        https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/#type-NodeTreeSnapshot

      2. Note that so far the below will NOT produce text for and therefore we will NOT
      index textarea or input elements. We can access those by using the textValue and
      inputValue array properties of the doc, if we want to implement that.
    */
       
    const texts = [];
    for( const doc of documents) {
      const textIndices = doc.nodes.nodeType.reduce((Indices, type, index) => {
        if ( type === TEXT_NODE ) {
          const parentIndex = doc.nodes.parentIndex[index];
          const forbiddenParent = parentIndex >= 0 && 
            FORBIDDEN_TEXT_PARENT.has(strings[
              doc.nodes.nodeName[
                parentIndex
              ]
            ])
          if ( ! forbiddenParent ) {
            Indices.push(index);
          }
        }
        return Indices;
      }, []);
      textIndices.forEach(index => {
        const stringsIndex = doc.nodes.nodeValue[index];
        const text = strings[stringsIndex];
        texts.push(text);
      });
    }

    const pageText = texts.filter(t => t.trim()).join(' ');
    DEBUG && console.log('Page text>>>', pageText);
    return pageText;
  }

  async function attachToTarget(targetInfo) {
    if ( dontCache(targetInfo) ) return;
    const {url} = targetInfo;
    if ( !!url && url != "about:blank" && !url.startsWith('chrome') ) {

      if ( targetInfo.type == 'page' ) {
        if ( ! targetInfo.attached ) {
          const {sessionId} = await send("Target.attachToTarget", {
            targetId: targetInfo.targetId,
            flatten: true
          });
          Sessions.set(targetInfo.targetId, sessionId);
        }
      }
    }
  }

  async function cacheRequest(pausedRequest) {
    const {
      requestId, request, resourceType, 
      responseStatusCode, responseHeaders, responseErrorReason
    } = pausedRequest;
    const {url} = request;
    const isNavigationRequest = resourceType == "Document";
    const isFont = resourceType == "Font";


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
      const resp = await getBody({requestId, responseStatusCode});
      if ( !! resp ) {
        let {body, base64Encoded} = resp;
        if ( ! base64Encoded ) {
          body = b64(body);
        }
        response.body = body;
        const responsePath = await saveResponseData(key, request.url, response);
        State.Cache.set(key, responsePath);
      } else {
        DEBUG && console.warn("get response body error", key, responseStatusCode, responseHeaders, pausedRequest.responseErrorReason);  
        response.body = '';
      }
      await sleep(DELAY);
      if ( !isFont && responseErrorReason ) {
        if ( isNavigationRequest ) {
          await send("Fetch.fulfillRequest", {
              requestId,
              responseHeaders: BLOCKED_HEADERS,
              responseCode: BLOCKED_CODE,
              body: Buffer.from(responseErrorReason).toString("base64"),
            },
          );
        } else {
          await send("Fetch.failRequest", {
              requestId,
              errorReason: responseErrorReason
            },
          );
        }
      } else {
        try {
          await send("Fetch.continueRequest", {
              requestId,
            },
          );
        } catch(e) {
          console.warn("Issue with continuing request", e, message);
        }
      }
    }
  }

  async function getBody({requestId, responseStatusCode}) {
    let resp;
    if ( ! BODYLESS.has(responseStatusCode) ) {
      resp = await send("Fetch.getResponseBody", {requestId});
    } else {
      resp = {body:'', base64Encoded:true};
    }
    return resp;
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
    await Fs.promises.writeFile(responsePath, JSON.stringify(response,null,2));

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
    Fs.writeFileSync(path || CACHE_FILE(), JSON.stringify([...State.Cache.entries()],null,2));
  }
}

function saveIndex(path) {
  if ( context == 'node' ) {
    //DEBUG && console.log("Writing to", path || INDEX_FILE());
    //DEBUG && console.log([...State.Index.entries()].sort(SORT_URLS));
    Fs.writeFileSync(
      path || INDEX_FILE(), 
      JSON.stringify([...State.Index.entries()].sort(SORT_URLS),null,2)
    );
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


