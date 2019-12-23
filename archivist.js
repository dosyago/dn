import {context} from './common.js';
import {connect} from './protocol.js';

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

const UNCACHED_BODY = Buffer.from('We have not saved this data').toString('base64');
const UNCACHED_CODE = 404;
const UNCACHED_HEADERS = [
  { name: 'Content-type', value: 'text/plain' },
  { name: 'Content-length', value: '26' }
];

let Fs;

export default Archivist;

async function collect({chrome_port:port, mode} = {}) {
  const {send, on, ons} = await connect({port});

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
    setInterval(saveCache, 10000);
  } else if ( mode == 'serve' ) {
    requestStage = "Request";
    if ( context == 'node' ) {
      State.Cache = new Map(JSON.parse(Fs.readFileSync('cache.json')));
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
        let {body, responseCode, responseHeaders} = State.Cache.get(key);
        responseCode = responseCode || 200;
        console.log("Fulfilling", key, responseCode, responseHeaders, body.slice(0,140));
        await send("Fetch.fulfillRequest", {
          requestId, body, responseCode, responseHeaders
        });
      } else {
        console.log("Sending cache stub", key);
        await send("Fetch.fulfillRequest", {
          requestId, body:UNCACHED_BODY, responseCode:UNCACHED_CODE, responseHeaders:UNCACHED_HEADERS
        });
      } 
    } else if ( mode == 'save' ) {
      const response = {responseCode: responseStatusCode, responseHeaders};
      const resp = await send("Fetch.getResponseBody", {requestId});
      if ( !! resp ) {
        let {body, base64Encoded} = resp;
        if ( ! base64Encoded ) {
          body = Buffer.from(body);
          body = body.toString('base64');
        }
        response.body = body;
      } else {
        response.body = '';
      }
      State.Cache.set(key, response);
      await send("Fetch.continueRequest", {requestId});
    }
  }

  function serializeRequest(request) {
    const {url, urlFragment, method, headers, postData, hasPostData} = request;

    let sortedHeaders = '';
    for( const key of Object.keys(headers).sort() ) {
      sortedHeaders += `${key}:${headers[key]}/`;
    }

    return `${method}${url}`;
    //return `${url}${urlFragment}:${method}:${sortedHeaders}:${postData}:${hasPostData}`;
  }

  function saveCache() {
    if ( context == 'node' ) {
      Fs.writeFileSync("cache.json", JSON.stringify([...State.Cache.entries()]));
    }
  }
}


