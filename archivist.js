// Licenses
  // FlexSearch is Apache-2.0 licensed
    // Source: https://github.com/nextapps-de/flexsearch/blob/bffb255b7904cb7f79f027faeb963ecef0a85dba/LICENSE
  // NDX is MIT licensed
    // Source: https://github.com/ndx-search/ndx/blob/cc9ec2780d88918338d4edcfca2d4304af9dc721/LICENSE
  
// module imports
  import hasha from 'hasha';
  import {URL} from 'url';
  import Path from 'path';
  import os from 'os';
  import Fs from 'fs';
  import { stdin as input, stdout as output } from 'process';
  import util from 'util';
  import readline from 'readline';

  // search related
    import FlexSearch from 'flexsearch';
    import { 
      createIndex as NDX, 
      addDocumentToIndex as ndx, 
      removeDocumentFromIndex, 
      vacuumIndex 
    } from 'ndx';
    import { query as NDXQuery } from 'ndx-query';
    import { toSerializable, fromSerializable } from 'ndx-serializable';
    //import { DocumentIndex } from 'ndx';
    //import Fuzzy from 'fz-search';
    import * as _Fuzzy from './lib/fz.js';
    import Nat from 'natural';
    //import match from 'autosuggest-highlight/match';
    //import parse from 'autosuggest-highlight/parse';

  import args from './args.js';
  import {
    APP_ROOT, context, sleep, DEBUG, 
    clone,
    SNIP_CONTEXT,
    CHECK_INTERVAL, TEXT_NODE, FORBIDDEN_TEXT_PARENT
  } from './common.js';
  import {connect} from './protocol.js';
  import {getInjection} from './public/injection.js';
  import {BLOCKED_BODY, BLOCKED_CODE, BLOCKED_HEADERS} from './blockedResponse.js';

// search related state: constants and variables
  // common
    const Fuzzy = globalThis.FuzzySearch;
    const NDX_OLD = false;
    const USE_FLEX = true;
    const FTS_INDEX_DIR = args.fts_index_dir;
    const URI_SPLIT = /[\/.]/g;
    const NDX_ID_KEY = 'ndx_id';
    const INDEX_HIDDEN_KEYS = new Set([
      NDX_ID_KEY
    ]);
    const hiddenKey = key => key.startsWith('ndx') || INDEX_HIDDEN_KEYS.has(key);
    let Id;

  // natural (NLP tools -- stemmers and tokenizers, etc)
    const Tokenizer = new Nat.WordTokenizer();
    const Stemmer = Nat.PorterStemmer;
    //const Stemmer = Nat.LancasterStemmer; // EN only
    const words = Tokenizer.tokenize.bind(Tokenizer);
    const termFilter = Stemmer.stem.bind(Stemmer);
    //const termFilter = s => s.toLocaleLowerCase();

  // FlexSearch
    const {Index: FTSIndex, registerCharset, registerLanguage} = FlexSearch;
    const FLEX_OPTS = {
      charset: "utf8",
      context: true,
      language: "en",
      tokenize: "reverse"
    };
    let Flex = new FTSIndex(FLEX_OPTS);
    DEBUG && console.log({Flex});

  // NDX
    const NDXRemoved = new Set();
    const REMOVED_CAP_TO_VACUUM_NDX = 10;
    const NDX_FIELDS = ndxDocFields();
    let NDX_FTSIndex = new NDXIndex(NDX_FIELDS);
    let NDXId;
    DEBUG && console.log({NDX_FTSIndex});

  // fuzzy (maybe just for queries ?)
    const FUZZ_OPTS = {
      keys: ndxDocFields({namesOnly:true})
    };
    const Docs = new Map();
    const fuzzy = new Fuzzy({source: [...Docs.values()], keys: FUZZ_OPTS.keys});

// module state: constants and variables
  // cache is a simple map
    // that holds the serialized requests
    // that are saved on disk
  const Status = {
    loaded: false
  };
  const Targets = new Map();
  const UpdatedKeys = new Set();
  const Cache = new Map();
  const Index = new Map();
  const Indexing = new Set();
  const BLANK_STATE = {
    Docs,
    Indexing,
    Cache, 
    Index,
    NDX_FTSIndex,
    Flex,
    SavedCacheFilePath: null,
    SavedIndexFilePath: null,
    SavedFTSIndexDirPath: null,
    SavedFuzzyIndexDirPath: null,
    saver: null,
    indexSaver: null,
    ftsIndexSaver: null,
    saveInProgress: false,
    ftsSaveInProgress: false
  };
  const State = Object.assign({}, BLANK_STATE);
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
    collect, getMode, changeMode, shutdown, 
    beforePathChanged,
    afterPathChanged,
    saveIndex,
    getIndex,
    search,
    getDetails,
    isReady,
    findOffsets,
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
  let Mode, Close;

// shutdown and cleanup
  // handle writing out indexes and closing browser connection when resetting under nodemon
    process.once('SIGUSR2', function () {
      shutdown(function () {
        process.kill(process.pid, 'SIGUSR2');
      });
    });

export default Archivist;

// main
  async function collect({chrome_port:port, mode} = {}) {
    const {library_path} = args;
    const {send, on, close} = await connect({port});
    const Sessions = new Map();
    const Installations = new Set();
    const ConfirmedInstalls = new Set();
    const DELAY = 100; // 500 ?
    Close = close;
    Mode = mode; 

    let requestStage;
    
    await loadFiles();

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
    await Promise.all(pageTargets.map(attachToTarget));

    Status.loaded = true;

    return Status.loaded;

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
      DEBUG && console.log('Received titleChange', titleChange);
      const latestTargetInfo = clone(await untilHas(Targets, sessionId));
      latestTargetInfo.title = currentTitle;
      Targets.set(sessionId, latestTargetInfo);
      DEBUG && console.log('Updated stored target info', latestTargetInfo);
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
        DEBUG && console.log('Updating target info', targetInfo, sessionId);
        if ( sessionId ) {
          const existingTargetInfo = Targets.get(sessionId);
          // if we have an existing target info for this URL and have saved an updated title
          DEBUG && console.log('Existing target info', existingTargetInfo);
          if ( existingTargetInfo && existingTargetInfo.url === targetInfo.url ) {
            // keep that title (because targetInfo does not reflect the latest title)
            if ( existingTargetInfo.title !== existingTargetInfo.url ) {
              DEBUG && console.log('Setting title to existing', existingTargetInfo);
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
          DEBUG && console.log({reloadingAsNotConfirmedInstalled:{url, sessionId}});
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

      DEBUG && console.log("installForSession running on target " + targetId);

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

      DEBUG && console.log('Installed sessionId', sessionId);
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
      let id, ndx_id;
      if ( State.Index.has(url) ) {
        ({ndx_id, id} = State.Index.get(url));
      } else {
        Id++;
        id = Id;
      }
      const doc = toNDXDoc({id, url, title, pageText});
      State.Index.set(url, {id:doc.id, ndx_id:doc.ndx_id, title});   
      State.Index.set(doc.id, url);
      State.Index.set('ndx'+doc.ndx_id, url);

      const contentSignature = getContentSig(doc);

      //Flex code
      Flex.update(doc.id, contentSignature);

      //New NDX code
      const res = NDX_FTSIndex.update(doc, ndx_id);

      // Fuzzy 
      // eventually we can use this update logic for everyone
      let updateFuzz = true;
      if ( State.Docs.has(url) ) {
        const current = State.Docs.get(url);
        if ( current.contentSignature === contentSignature ) {
          updateFuzz = false;
        }
      }
      if ( updateFuzz ) {
        doc.contentSignature = contentSignature;
        fuzzy.add(doc);
        State.Docs.set(url, doc);
        console.log(doc,url);
      }

      DEBUG && console.log("NDX updated", doc.ndx_id);

      UpdatedKeys.add(url);

      console.log({id: doc.id, title, url, indexed: true});

      State.Indexing.delete(info.targetId);
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
  async function isReady() {
    return await untilHas(Status, 'loaded');
  }

  async function loadFuzzy() {
    const DEBUG = true;
    const fuzzyDocs = Fs.readFileSync(getFuzzyPath()).toString();
    State.Docs = new Map(JSON.parse(fuzzyDocs).map(doc => {
      doc.i_url = getURI(doc.url);
      doc.contentSignature = getContentSig(doc);
      return [doc.url, doc];
    }));
    await Promise.all([...State.Docs.values()].map(async doc => fuzzy.add(doc)));
    DEBUG && console.log('Fuzzy loaded');
  }

  function getContentSig(doc) { 
    return doc.title + ' ' + doc.content + ' ' + getURI(doc.url);
  }

  function getURI(url) {
    return url.split(URI_SPLIT).join(' ');
  }

  function saveFuzzy(basePath) {
    const docs = [...State.Docs.values()]
      .map(({url, title, content, id}) => ({url, title, content, id}));
    const path = getFuzzyPath(basePath);
    Fs.writeFileSync(
      path,
      JSON.stringify(docs)
    );
    console.log(`Wrote fuzzy to ${path}`);
  }

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

  async function loadFiles() {
    let cacheFile = CACHE_FILE();
    let indexFile = INDEX_FILE();
    let ftsDir = FTS_INDEX_DIR();
    let someError = false;

    try {
      State.Cache = new Map(JSON.parse(Fs.readFileSync(cacheFile)));
    } catch(e) {
      State.Cache = new Map();
      someError = true;
    }

    try {
      State.Index = new Map(JSON.parse(Fs.readFileSync(indexFile)));
    } catch(e) {
      State.Index = new Map();
      someError = true;
    }

    try {
      const DEBUG = true;
      const flexBase = getFlexBase();
      Fs.readdirSync(flexBase, {withFileTypes:true}).forEach(dirEnt => {
        if ( dirEnt.isFile() ) {
          const content = Fs.readFileSync(Path.resolve(flexBase, dirEnt.name)).toString();
          Flex.import(dirEnt.name, JSON.parse(content));
        }
      });
      DEBUG && console.log('Flex loaded');
    } catch(e) {
      someError = true;
    }

    try {
      loadNDXIndex(NDX_FTSIndex);
    } catch(e) {
      someError = true;
    }

    try {
      loadFuzzy();
    } catch(e) {
      someError = true;
    }

    if ( someError ) {
      const rl = readline.createInterface({input, output});
      const question = util.promisify(rl.question).bind(rl);
      console.warn('Error reading archive file. Your archive directory is corrupted. We will attempt to patch it so you can use it going forward, but because we replace a missing or corrupt index, cache, or full-text search index files with new blank copies, existing resources already indexed and cached may become inaccessible from your new index. A future version of this software should be able to more completely repair your archive directory, reconnecting and re-existing all cached resources and notifying you about and purging from the index any missing resources.\n');
      console.log('Sorry about this, we are not sure why this happened, but we know this must be very distressing for you.\n');
      console.log(`For your information, the corruped archive directory is at: ${args.getBasePath()}\n`);
      console.info('Because this repair as described above is not a perfect solution, we will give you a choice of how to proceed. You have two options: 1) attempt a basic repair that may leave some resources inaccessible from the repaired archive, or 2) do not touch the corrupted archive, but instead create a new fresh blank archive to begin saving to. Which option would you like to proceed with?');
      console.log('1) Basic repair with possible inaccessible pages');
      console.log('2) Leave the corrupt archive untouched, start a new archive');
      let correctAnswer = false;
      let newBasePath = '';
      while(!correctAnswer) {
        let answer = await question('Which option would you like (1 or 2)? ');
        answer = parseInt(answer);
        switch(answer) {
          case 1: {
            console.log('Alright, selecting option 1. Using the existing archive and patching a simple repair.');
            newBasePath = args.getBasePath();
            correctAnswer = true;
          }; break;
          case 2: {
            console.log('Alright, selection option 2. Leaving the existing archive along and creating a new, fresh, blank archive.');
            let correctAnswer2 = false;
            while( ! correctAnswer2 ) {
              try {
                newBasePath = Path.resolve(os.homedir(), await question(
                  'Please enter a directory name for your new archive.\n' +
                  `${os.homedir()}/`
                ));
                correctAnswer2 = true;
              } catch(e2) {
                console.warn(e2);
                console.info('Sorry that was not a valid directory name.');
                await question('enter to continue');
              }
            }
            correctAnswer = true;
          }; break;
          default: {
            correctAnswer = false;
            console.log('Sorry, that was not a valid option. Please input 1 or 2.');
          }; break;
        }
      }
      console.log('Resetting base path', newBasePath);
      args.updateBasePath(newBasePath, {force:true});
      saveFiles({forceSave:true});
    }

    Id = Math.round(State.Index.size / 2) + 3;
    NDXId = State.Index.has(NDX_ID_KEY) ? State.Index.get(NDX_ID_KEY) + 3000 : (Id + 1000000);
    if ( !Number.isInteger(NDXId) ) NDXId = Id;
    DEBUG && console.log({firstFreeId: Id, firstFreeNDXId: NDXId});

    State.SavedCacheFilePath = cacheFile;
    State.SavedIndexFilePath = indexFile;
    State.SavedFTSIndexDirPath = ftsDir;
    DEBUG && console.log(`Loaded cache key file ${cacheFile}`);
    DEBUG && console.log(`Loaded index file ${indexFile}`);
    DEBUG && console.log(`Need to load FTS index dir ${ftsDir}`);

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

  function saveFiles({useState: useState = false, forceSave:forceSave = false} = {}) {
    clearSavers();
    State.Index.set(NDX_ID_KEY, NDXId);
    if ( useState ) {
      // saves the old cache path
      saveCache(State.SavedCacheFilePath);
      saveIndex(State.SavedIndexFilePath);
      saveFTS(State.SavedFTSIndexDirPath, {forceSave});
    } else {
      saveCache();
      saveIndex();
      saveFTS(null, {forceSave});
    }
  }

  async function changeMode(mode) { 
    DEBUG && console.log({modeChange:mode});
    saveFiles({forceSave:true});
    Close && Close();
    Mode = mode;
    await collect({chrome_port:args.chrome_port, mode});
  }

  function getDetails(id) {
    const url = State.Index.get(id);
    const {title} = State.Index.get(url);
    const {content} = State.Docs.get(url);
    return {url, title, id, content};
  }

  function findOffsets(query, doc, count = 0) {
    const hl = fuzzy.highlight(doc); 
    DEBUG && console.log(hl);
    return hl;
  }

  function beforePathChanged() {
    saveFiles({useState:true, forceSave:true});
    // clear all memory cache, index and full text indexes
    State.Index.clear();
    State.Cache.clear();
    State.NDX_FTSIndex = NDX_FTSIndex = new NDXIndex(NDX_FIELDS);
    State.Flex = Flex = new FTSIndex(FLEX_OPTS);
  }

  async function afterPathChanged() { 
    DEBUG && console.log({libraryPathChange:args.library_path()});
    saveFiles({useState:true, forceSave:true});
    // reloads from new path and updates Saved FilePaths
    await loadFiles();
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

  function getIndex() {
    return JSON.parse(Fs.readFileSync(INDEX_FILE()))
      .filter(([key, val]) => typeof key === 'string' && !hiddenKey(key));
  }

  async function search(query) {
    const flex = (await Flex.searchAsync(query, args.results_per_page))
      .map(id=> ({id, url: State.Index.get(id)}));
    const ndx = NDX_FTSIndex.search(query)
      .map(r => ({
        ndx_id: r.key, 
        url: State.Index.get('ndx'+r.key), 
        score: r.score
      }));
    const fuzzRaw = fuzzy.search(query);
    const fuzz = processFuzzResults(fuzzRaw);

    const results = combineResults({flex, ndx, fuzz});

    const HL = new Map();
    const highlights = fuzzRaw.map(obj => {
      const title = State.Index.get(obj.url)?.title;
      return {
        id: obj.id,
        url: Archivist.findOffsets(query, obj.url) || obj.url,
        title: Archivist.findOffsets(query, title) || title,
      };
    });
    highlights.forEach(hl => HL.set(hl.id, hl));

    return {query,results, HL};
  }

  function combineResults({flex,ndx,fuzz}) {
    DEBUG && console.log({flex,ndx,fuzz});
    const score = {};
    flex.forEach(countRank(score));
    ndx.forEach(countRank(score));
    fuzz.forEach(countRank(score));
  
    const results = [...Object.values(score)].map(obj => {
      try {
        const {id} = State.Index.get(obj.url); 
        obj.id = id;
        return obj;
      } catch(e) {
        console.log(obj, State.Index, e);
        throw e;
      }
    });
    results.sort(({score:scoreA}, {score:scoreB}) => scoreA-scoreB);
    const resultIds = results.map(({id}) => id);
    return resultIds;
  }

  function countRank(record, weight = 1.0) {
    return ({url,id}, rank, all) => {
      let score = record[url];
      if ( ! score ) {
        score = record[url] = {
          url,
          value: 0
        };
      }

      score.value += weight*(all.length - rank)
    };
  }

  function processFuzzResults(docs) {
    const docIds = docs.map(({id}) => id); 
    const uniqueIds = new Set(docIds);
    return [...uniqueIds.keys()].map(id => ({id, url:State.Index.get(id)}));
  }

  async function saveFTS(path = undefined, {forceSave:forceSave = false} = {}) {
    if ( State.ftsSaveInProgress ) return;
    State.ftsSaveInProgress = true;

    clearTimeout(State.ftsIndexSaver);

    if ( context == 'node' ) {
      DEBUG && console.log("Writing FTS index to", path || FTS_INDEX_DIR());
      const dir = path || FTS_INDEX_DIR();

      if ( forceSave || UpdatedKeys.size ) {
        DEBUG && console.log(`${UpdatedKeys.size} keys updated since last write`);
        const flexBase = getFlexBase(dir);
        Flex.export((key, data) => {
          key = key.split('.').pop();
          try {
            Fs.writeFileSync(
              Path.resolve(flexBase, key),
              JSON.stringify(data)
            );
          } catch(e) {
            console.error('Error writing full text search index', e);
          }
        });
        console.log(`Wrote Flex to ${flexBase}`);
        NDX_FTSIndex.save(dir);
        saveFuzzy(dir);
        UpdatedKeys.clear();
      } else {
        DEBUG && console.log("No FTS keys updated, no writes needed this time.");
      }
    }

    State.ftsIndexSaver = setTimeout(saveFTS, 31001);
    State.ftsSaveInProgress = false;
  }

  function shutdown(then) {
    DEBUG && console.log(`Archivist shutting down...`);  
    saveFiles({forceSave:true});
    Close && Close();
    DEBUG && console.log(`Archivist shut down.`);
    return then && then();
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
          doc.ndx_id,
          // Document.
          doc,
        ),
        remove: id => {
          removeDocumentFromIndex(retVal.index, NDXRemoved, id);
          maybeClean();
        },
        update: (doc, old_id) => {
          retVal.remove(old_id);
          retVal.add(doc);
        },
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
          NDXRemoved, 
          q,
        ),
        save: (basePath) => {
          maybeClean(true);
          const obj = toSerializable(retVal.index);
          const objStr = JSON.stringify(obj);
          const path = getNDXPath(basePath);
          Fs.writeFileSync(
            path,
            objStr
          );
          console.log("Write NDX to ", path);
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

    DEBUG && console.log('ndx setup', {retVal});
    return retVal;

    function maybeClean(doIt = false) {
      if ( (doIt && NDXRemoved.size) || NDXRemoved.size >= REMOVED_CAP_TO_VACUUM_NDX ) {
        vacuumIndex(retVal.index, NDXRemoved);
      }
    }
  }

  function loadNDXIndex(ndxFTSIndex) {
    const DEBUG = true;
    if ( Fs.existsSync(getNDXPath()) ) {
      const indexContent = Fs.readFileSync(getNDXPath()).toString();
      const index = fromSerializable(JSON.parse(indexContent));
      ndxFTSIndex.load(index);
    }
    DEBUG && console.log('NDX loaded');
  }

  function toNDXDoc({id, url, title, pageText}) {
    // use existing defined id or a new one
    return {
      id, 
      ndx_id: NDXId++,
      url,
      i_url: getURI(url),
      title, 
      content: pageText
    };
  }

  function ndxDocFields({namesOnly:namesOnly = false} = {}) {
    if ( !namesOnly && !NDX_OLD ) {
      /* old format (for newer ndx >= v1 ) */
      return [
        /* we index over the special indexable url field, not the regular url field */
        { name: "i_url" }, 
        { name: "title" },
        { name: "content" },
      ];
    } else {
      /* new format (for older ndx ~ v0.4 ) */
      return [
        "i_url",
        "title",
        "content"
      ];
    }
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
            DEBUG && console.log(thing, "not have", key);
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
            DEBUG && console.log(thing, "not have", key);
          }
        }, CHECK_INTERVAL);

        return pr;
      }
    } else if ( typeof thing === "object" ) {
      if ( thing[key] ) {
        return true;
      } else {
        let resolve;
        const pr = new Promise(res => resolve = res);
        const checker = setInterval(() => {
          if ( thing[key] ) {
            clearInterval(checker);
            resolve(true);
          } else {
            DEBUG && console.log(thing, "not have", key);
          }
        }, CHECK_INTERVAL);

        return pr;
      }
    } else {
      throw new TypeError(`untilHas with thing of type ${thing} is not yet implemented!`);
    }
  }

  function getNDXPath(basePath) {
    return Path.resolve(args.ndx_fts_index_dir(basePath), 'index.ndx');
  }

  function getFuzzyPath(basePath) {
    return Path.resolve(args.fuzzy_fts_index_dir(basePath), 'docs.fzz');
  }

  function getFlexBase(basePath) {
    return args.flex_fts_index_dir(basePath);
  }



