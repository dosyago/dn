import hasha from 'hasha';
import {URL} from 'url';
import path from 'path';
import {context, sleep, DEBUG} from './common.js';
import {connect} from './protocol.js';
import {libraryPath} from './libraryServer.js';

// cache is a simple map
  // that holds the serialized requests
  // that are saved on disk
const Cache = new Map();
const State = {
  Cache
}

const Archivist = { 
  collect 
}

const CACHE_FILE = path.join(libraryPath, 'cache.json');
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

let Fs;

export default Archivist;

async function collect({chrome_port:port, mode} = {}) {
  const {send, on} = await connect({port});

  if ( context == 'node' ) {
    const {default:fs} = await import('fs');
    Fs = fs;
  }

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
  
  if ( mode == 'save' ) {
    requestStage = "Response";
    try {
      State.Cache = new Map(JSON.parse(Fs.readFileSync(CACHE_FILE)));
    } catch(e) {
      State.Cache = new Map();
    }
    process.on('SIGINT', saveCache);
    setInterval(saveCache, 10000);
  } else if ( mode == 'serve' ) {
    requestStage = "Request";
    if ( context == 'node' ) {
      State.Cache = new Map(JSON.parse(Fs.readFileSync(CACHE_FILE)));
    }
  } else {
    throw new TypeError(`Must specify mode`);
  }

  send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "http*://*", 
        requestStage
      }
    ]
  });
  on("Fetch.requestPaused", cacheRequest);

  async function cacheRequest(pausedRequest) {
    const {requestId, request, responseStatusCode, responseHeaders} = pausedRequest;
    const key = serializeRequest(request);
    if ( mode == 'serve' ) {
      if ( State.Cache.has(key) ) {
        let {body, responseCode, responseHeaders} = await getResponseData(State.Cache.get(key));
        responseCode = responseCode || 200;
        DEBUG && console.log("Fulfilling", key, responseCode, responseHeaders, body.slice(0,140));
        await send("Fetch.fulfillRequest", {
          requestId, body, responseCode, responseHeaders
        });
      } else {
        DEBUG && console.log("Sending cache stub", key);
        await send("Fetch.fulfillRequest", {
          requestId, ...UNCACHED
        });
      } 
    } else if ( mode == 'save' ) {
      if ( responseStatusCode == 302 ) {
        return send("Fetch.continueRequest", {requestId});
      }
      const response = {key, responseCode: responseStatusCode, responseHeaders};
      let resp = await send("Fetch.getResponseBody", {requestId});
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

  async function getResponseData(path) {
    try {
      return JSON.parse(await Fs.promises.readFile(path));
    } catch(e) {
      console.warn(`Error with ${path}`, e);
      return UNCACHED;
    }
  }

  async function saveResponseData(key, url, response) {
    const origin = (new URL(url).origin).replace(TBL, '_');
    const hash = await hasha(key, HASH_OPTS); 
    const fileName = `${hash}.json`;
    const responsePath = path.join(libraryPath, origin, fileName);
    if ( ! State.Cache.has(origin) ) {
      try {
        await Fs.promises.mkdir(path.dirname(responsePath), {recursive:true});
      } catch(e) {
        console.warn(`Issue with origin directory ${path.dirname(responsePath)}`, e);
      }
      State.Cache.set(origin, origin);
    }
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

  function saveCache() {
    if ( context == 'node' ) {
      Fs.writeFileSync(CACHE_FILE, JSON.stringify([...State.Cache.entries()]));
    }
  }
}

function b64(s) {
  if ( context == 'node' ) {
    return Buffer.from(s).toString('base64');
  } else {
    return btoa(s);
  }
}


