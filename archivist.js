// Licenses
  // FlexSearch is Apache-2.0 licensed
    // Source: https://github.com/nextapps-de/flexsearch/blob/bffb255b7904cb7f79f027faeb963ecef0a85dba/LICENSE
  // NDX is MIT licensed
    // Source: https://github.com/ndx-search/ndx/blob/cc9ec2780d88918338d4edcfca2d4304af9dc721/LICENSE
  
// module imports
  import hasha from 'hasha';
  import {URL} from 'url';
  import Path from 'path';
  import fs from 'fs';
  // search related
    import FlexSearch from 'flexsearch';
    import { createIndex as NDX, addDocumentToIndex as ndx } from 'ndx';
    import { query as NDXQuery } from 'ndx-query';
    import { toSerializable, fromSerializable } from 'ndx-serializable';
    //import { DocumentIndex } from 'ndx';
    import Nat from 'natural';

  import args from './args.js';
  import {
    APP_ROOT, context, sleep, DEBUG, 
    clone,
    CHECK_INTERVAL, TEXT_NODE, FORBIDDEN_TEXT_PARENT
  } from './common.js';
  import {connect} from './protocol.js';
  import {getInjection} from './public/injection.js';
  import {BLOCKED_BODY, BLOCKED_CODE, BLOCKED_HEADERS} from './blockedResponse.js';

// search related state: constants and variables
  // common
    const NDX_OLD = false;
    const USE_FLEX = false;
    const FTS_INDEX_DIR = args.fts_index_dir;
    const NDX_FTS_INDEX_DIR = args.ndx_fts_index_dir;

  // FlexSearch
    const {Index: FTSIndex, registerCharset, registerLanguage} = FlexSearch;
    const FLEX_OPTS = {
      context: true,
      language: "en"
    };
    const Flex = new FTSIndex(FLEX_OPTS);

  // natural (NLP tools -- stemmers and tokenizers, etc)
    const Tokenizer = new Nat.WordTokenizer();
    const StemmerEn = Nat.PorterStemmer;

  // NDX
    let Id;
    const NDX_FIELDS = ndxDocFields();
    const words = Tokenizer.tokenize.bind(Tokenizer);
    //const termFilter = StemmerEn.stem.bind(StemmerEn);
    const termFilter = s => s.toLocaleLowerCase();
    const NDX_FTSIndex = new NDXIndex(NDX_FIELDS);

// module state: constants and variables
  // cache is a simple map
    // that holds the serialized requests
    // that are saved on disk
  let Fs, Mode, Close;
  const Targets = new Map();
  const UpdatedKeys = new Set();
  const Cache = new Map();
  const Index = new Map();
  const Indexing = new Set();
  const State = {
    Indexing,
    Cache, 
    Index,
    SavedCacheFilePath: null,
    SavedIndexFilePath: null,
    SavedFTSIndexDirPath: null,
    saver: null,
    indexSaver: null,
    ftsIndexSaver: null,
    saveInProgress: false,
    ftsSaveInProgress: false
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
    NDX_OLD,
    USE_FLEX,
    collect, getMode, changeMode, shutdown, handlePathChanged, saveIndex,
    search,
    getDetails
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

// main
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
      State.saver = setInterval(() => saveCache(State.SavedCacheFilePath), 17000);
      // we use timeout because we can trigger this ourself
      // so in order to not get a race condition (overlapping calls) we ensure 
      // only 1 call at 1 time
      State.indexSaver = setTimeout(() => saveIndex(State.SavedIndexFilePath), 11001);
      State.ftsIndexSaver = setTimeout(() => saveFTS(State.SavedFTSIndexDirPath), 31001);
    } else if ( Mode == 'serve' ) {
      requestStage = "Request";
    } else {
      throw new TypeError(`Must specify mode`);
    }

    //on("Target.targetInfoChanged", displayTargetInfo);
    on("Target.targetInfoChanged", attachToTarget);
    on("Target.targetInfoChanged", reloadIfNotLive);
    on("Target.targetInfoChanged", updateTargetInfo);
    on("Target.targetInfoChanged", indexURL);
    on("Target.attachedToTarget", installForSession);
    on("Fetch.requestPaused", cacheRequest);
    on("Runtime.consoleAPICalled", handleMessage);

    await send("Target.setDiscoverTargets", {discover:true});
    await send("Target.setAutoAttach", {autoAttach:true, waitForDebuggerOnStart:false, flatten: true});
    await send("Fetch.enable", {
      patterns: [
        {
          urlPattern: "http*://*", 
          requestStage
        }
      ], 
    });

    const {targetInfos:targets} = await send("Target.getTargets", {});
    const pageTargets = targets.filter(({type}) => type == 'page');
    pageTargets.forEach(attachToTarget);

    function guard(func, text = '') {
      return (...args) => {
        //DEBUG && console.log({text, func:func.name, args:JSON.stringify(args,null,2)});

        return func(...args);
      };
    }

    function handleMessage(args) {
      const {type, args:[{value:strVal}], context} = args;
      if ( type == 'info' ) {
        try {
          const val = JSON.parse(strVal);
          // possible messages
          const {install, titleChange} = val;
          switch(true) {
            case !!install: {
                confirmInstall({install});
              }; break;
            case !!titleChange: {
                reindexOnTitleChange({titleChange});
              }; break;
            default: {
                if ( DEBUG ) {
                  console.warn(`Unknown message`, strVal);
                }
              }; break;
          }
        } catch(e) {
          DEBUG && console.info('Not the message we expected to confirm install. This is OK.', {originalMessage:args});
        } finally {} 
      }
    }

    function confirmInstall({install}) {
      const {sessionId} = install;
      if ( ! ConfirmedInstalls.has(sessionId) ) {
        ConfirmedInstalls.add(sessionId);
        console.log({confirmedInstall:val, context});
      }
    }

    async function reindexOnTitleChange({titleChange}) {
      const {currentTitle, url, sessionId} = titleChange;
      console.log('Received titleChange', titleChange);
      const latestTargetInfo = clone(await untilHas(Targets, sessionId));
      latestTargetInfo.title = currentTitle;
      Targets.set(sessionId, latestTargetInfo);
      console.log('Updated stored target info', latestTargetInfo);
      indexURL({targetInfo:latestTargetInfo});
    }

    function displayTargetInfo({targetInfo}) {
      if ( targetInfo.type === 'page' ) {
        console.log("Target info", JSON.stringify(targetInfo, null, 2));
      }
    }

    function updateTargetInfo({targetInfo}) {
      if ( targetInfo.type === 'page' ) {
        const sessionId = Sessions.get(targetInfo.targetId); 
        console.log('Updating target info', targetInfo, sessionId);
        if ( sessionId ) {
          const existingTargetInfo = Targets.get(sessionId);
          // if we have an existing target info for this URL and have saved an updated title
          console.log('Existing target info', existingTargetInfo);
          if ( existingTargetInfo && existingTargetInfo.url === targetInfo.url ) {
            // keep that title (because targetInfo does not reflect the latest title)
            if ( existingTargetInfo.title !== existingTargetInfo.url ) {
              console.log('Setting title to existing', existingTargetInfo);
              targetInfo.title = existingTargetInfo.title;
            }
          }
          Targets.set(sessionId, clone(targetInfo));
        }
      }
    }

    async function reloadIfNotLive({targetInfo}) {
      if ( Mode == 'serve' ) return; 
      const {attached, type} = targetInfo;
      if ( attached && type == 'page' ) {
        const {url, targetId} = targetInfo;
        const sessionId = Sessions.get(targetId);
        if ( !!sessionId && !ConfirmedInstalls.has(sessionId) ) {
          console.log({reloadingAsNotConfirmedInstalled:{url, sessionId}});
          send("Page.stopLoading", {}, sessionId);
          send("Page.reload", {}, sessionId);
        }
      }
    }

    function neverCache(url) {
      return url == "about:blank" || url?.startsWith('chrome') || NEVER_CACHE.has(url);
    }

    async function installForSession({sessionId, targetInfo, waitingForDebugger}) {
      if ( ! sessionId ) {
        throw new TypeError(`installForSession needs a sessionId`);
      }

      const {targetId, url} = targetInfo;

      if ( Mode == 'serve' ) return;

      if ( dontInstall(targetInfo) ) return;

      if ( targetInfo.type != 'page' ) return;

      if ( Installations.has(sessionId) ) return;

      console.log("installForSession running on " + targetId);

      Sessions.set(targetId, sessionId);
      Targets.set(sessionId, clone(targetInfo));

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

      console.log('Index URL called', info);

      if ( State.Indexing.has(info.targetId) ) return;
      State.Indexing.add(info.targetId);

      if ( ! sessionId ) {
        sessionId = await untilHas(Sessions, info.targetId);
      }

      if ( !Installations.has(sessionId) ) {
        await untilHas(Installations, sessionId);
      }

      send("DOMSnapshot.enable", {}, sessionId);

      await sleep(500);

      const flatDoc = await send("DOMSnapshot.captureSnapshot", {
        computedStyles: [],
      }, sessionId);
      const pageText = processDoc(flatDoc);

      const {title, url} = Targets.get(sessionId);
      let id;
      if ( State.Index.has(url) ) {
        ({id} = State.Index.get(url));
      }
      const doc = toNDXDoc({id, url, title, pageText});
      State.Index.set(url, {id:doc.id, title});   
      State.Index.set(doc.id, url);

      //Old Flex code
      Flex.update(doc.id, doc.title + ' ' + doc.content);

      //New NDX code
      const res = NDX_FTSIndex.add(doc);
      UpdatedKeys.add(info.url);

      console.log({title, url, indexed: true, searchable: true, indexType: 'full text and full content', res, doc});

      State.Indexing.delete(info.targetId);
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
          if ( stringsIndex >= 0 ) {
            const text = strings[stringsIndex];
            texts.push(text);
          }
        });
      }

      const pageText = texts.filter(t => t.trim()).join(' ');
      DEBUG && console.log('Page text>>>', pageText);
      return pageText;
    }

    async function attachToTarget(targetInfo) {
      if ( dontInstall(targetInfo) ) return;
      const {url} = targetInfo;
      if ( url && targetInfo.type == 'page' ) {
        if ( ! targetInfo.attached ) {
          const {sessionId} = await send("Target.attachToTarget", {
            targetId: targetInfo.targetId,
            flatten: true
          });
          Sessions.set(targetInfo.targetId, sessionId);
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
    
    function dontInstall(targetInfo) {
      return targetInfo.type !== 'page';
    }

    function dontCache(request) {
      if ( ! request.url ) return true;
      if ( neverCache(request.url) ) return true;
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
        originDir = Path.resolve(library_path(), origin.replace(TBL, '_'));
        try {
          await Fs.promises.mkdir(originDir, {recursive:true});
        } catch(e) {
          console.warn(`Issue with origin directory ${Path.dirname(responsePath)}`, e);
        }
        State.Cache.set(origin, originDir);
      }

      const fileName = `${await hasha(key, HASH_OPTS)}.json`;

      const responsePath = Path.resolve(originDir, fileName);
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

// helpers
  function clearSavers() {
    if ( State.saver ) {
      clearInterval(State.saver);
      State.saver = null;
    }

    if ( State.indexSaver ) {
      clearTimeout(State.indexSaver);
      State.indexSaver = null;
    }

    if ( State.ftsIndexSaver ) {
      clearTimeout(State.ftsIndexSaver);
      State.ftsIndexSaver = null;
    }
  }

  function loadFiles() {
    try {
      const cacheFile = CACHE_FILE();
      const indexFile = INDEX_FILE();
      const ftsDir = FTS_INDEX_DIR();

      State.Cache = new Map(JSON.parse(Fs.readFileSync(cacheFile)));
      State.Index = new Map(JSON.parse(Fs.readFileSync(indexFile)));
      Fs.readdirSync(ftsDir, {withFileTypes:true}).forEach(dirEnt => {
        if ( dirEnt.isFile() ) {
          const content = Fs.readFileSync(Path.resolve(ftsDir, dirEnt.name)).toString();
          Flex.import(dirEnt.name, JSON.parse(content));
        }
      });
      loadNDXIndex(NDX_FTSIndex);

      Id = State.Index.size / 2 + 3;
      console.log({Id});

      State.SavedCacheFilePath = cacheFile;
      State.SavedIndexFilePath = indexFile;
      State.SavedFTSIndexDirPath = ftsDir;
      DEBUG && console.log(`Loaded cache key file ${cacheFile}`);
      DEBUG && console.log(`Loaded index file ${indexFile}`);
      DEBUG && console.log(`Need to load FTS index dir ${ftsDir}`);
    } catch(e) {
      console.warn('Error reading archive file', e);
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
    saveFTS();
    Close && Close();
    Mode = mode;
    await collect({chrome_port:args.chrome_port, mode});
  }

  function getDetails(id) {
    const url = State.Index.get(id);
    console.log(id, url);
    const {title} = State.Index.get(url);
    return {url, title};
  }

  function handlePathChanged() { 
    DEBUG && console.log({libraryPathChange:args.library_path()});
    clearSavers();
    // saves the old cache path
    saveCache(State.SavedCacheFilePath);
    saveIndex(State.SavedIndexFilePath);
    saveFTS(State.SavedFTSIndexDirPath);
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
    if ( State.saveInProgress ) return;
    State.saveInProgress = true;

    clearTimeout(State.indexSaver);

    if ( context == 'node' ) {
      //DEBUG && console.log("Writing to", path || INDEX_FILE());
      //DEBUG && console.log([...State.Index.entries()].sort(SORT_URLS));
      Fs.writeFileSync(
        path || INDEX_FILE(), 
        JSON.stringify([...State.Index.entries()].sort(SORT_URLS),null,2)
      );
    }

    State.indexSaver = setTimeout(saveIndex, 11001);

    State.saveInProgress = false;
  }

  async function search(query) {
    let results;
    if ( USE_FLEX ) {
      results = await Flex.searchAsync(query, args.results_per_page);
    } else {
      // NDX code
      results = NDX_FTSIndex.search(query);
    }
    console.log({query, results});
    return {query,results};
  }

  async function saveFTS(path) {
    if ( State.ftsSaveInProgress ) return;
    State.ftsSaveInProgress = true;

    clearTimeout(State.ftsIndexSaver);

    if ( context == 'node' ) {
      DEBUG && console.log("Writing FTS index to", path || FTS_INDEX_DIR());
      const dir = path || FTS_INDEX_DIR();

      if ( UpdatedKeys.size ) {
        DEBUG && console.log(`${UpdatedKeys.size} keys updated since last write`);
        Flex.export((key, data) => {
          key = key.split('.').pop();
          try {
            Fs.writeFileSync(
              Path.resolve(dir, key),
              JSON.stringify(data)
            );
          } catch(e) {
            console.error('Error writing full text search index', e);
          }
        });
        NDX_FTSIndex.save();
        UpdatedKeys.clear();
      } else {
        DEBUG && console.log("No FTS keys updated, no writes needed this time.");
      }
    }

    State.ftsIndexSaver = setTimeout(saveFTS, 31001);
    State.ftsSaveInProgress = false;
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

  function NDXIndex(fields) {
    let retVal;

    if ( ! NDX_OLD ) {
      // Old code (from newer, in my opinion, worse, version)
        // source: 
          // adapted from:
          // https://github.com/ndx-search/docs/blob/94530cbff6ae8ea66c54bba4c97bdd972518b8b4/README.md#creating-a-simple-indexer-with-a-search-function

      if ( ! new.target ) { throw `NDXIndex must be called with 'new'`; }

      // `createIndex()` creates an index data structure.
      // First argument specifies how many different fields we want to index.
      const index = NDX(fields.length);
      // `fieldAccessors` is an array with functions that used to retrieve data from different fields. 
      const fieldAccessors = fields.map(f => doc => doc[f.name]);
      // `fieldBoostFactors` is an array of boost factors for each field, in this example all fields will have
      // identical factors.
      const fieldBoostFactors = fields.map(() => 1);
      
      retVal = {
        index,
        // `add()` function will add documents to the index.
        add: doc => ndx(
          retVal.index,
          fieldAccessors,
          // Tokenizer is a function that breaks text into words, phrases, symbols, or other meaningful elements
          // called tokens.
          // Lodash function `words()` splits string into an array of its words, see https://lodash.com/docs/#words for
          // details.
          words,
          // Filter is a function that processes tokens and returns terms, terms are used in Inverted Index to
          // index documents.
          termFilter,
          // Document key, it can be a unique document id or a refernce to a document if you want to store all documents
          // in memory.
          doc.id,
          // Document.
          doc,
        ),
        // `search()` function will be used to perform queries.
        search: q => NDXQuery(
          retVal.index,
          fieldBoostFactors,
          // BM25 ranking function constants:
          1.2,  // BM25 k1 constant, controls non-linear term frequency normalization (saturation).
          0.75, // BM25 b constant, controls to what degree document length normalizes tf values.
          words,
          termFilter,
          // Set of removed documents, in this example we don't want to support removing documents from the index,
          // so we can ignore it by specifying this set as `undefined` value.
          undefined, 
          q,
        ),
        save: () => {
          const obj = toSerializable(retVal.index);
          const objStr = JSON.stringify(obj);
          Fs.writeFileSync(
            Path.resolve(NDX_FTS_INDEX_DIR(), 'index.ndx'),
            objStr
          );
        },
        load: newIndex => {
          retVal.index = newIndex;
        }
      };
    } else {
      // Even older code (from older but, to me, much better, version: 0.4.1)
      const index = new DocumentIndex();
      fields.forEach(name => index.addField(name));

      retVal = {
        index,
        search: query => retVal.index.search(query),
        add: doc => retVal.index.add(doc.id, doc),
      };
    }

    console.log({retVal});
    return retVal;
  }

  function loadNDXIndex(ndxFTSIndex) {
    const DEBUG = true;
    try {
      const indexContent = Fs.readFileSync(
        Path.resolve(NDX_FTS_INDEX_DIR(), 'index.ndx'),
      ).toString();
      const index = fromSerializable(JSON.parse(indexContent));
      ndxFTSIndex.load(index);
    } catch(e) {
      DEBUG && console.warn('Could not load NDX FTS index from disk', e);
      console.log(ndxFTSIndex);
    }
  }

  function toNDXDoc({id, url, title, pageText}) {
    // use existing defined id or a new one
    id = id || Id++;
    return {
      id,
      url, title, 
      content: pageText
    };
  }

  function ndxDocFields() {
    if ( !NDX_OLD ) {
      /* old format (for newer ndx >= v1 ) */
      return [
        { name: "url" },
        { name: "title" },
        { name: "content" },
      ];
    } else {
      /* new format (for older ndx ~ v0.4 ) */
      return [
        "url",
        "title",
        "content"
      ];
    }
  }
