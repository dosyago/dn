import {SHOW_FETCH, DEBUG, context, ERROR_CODE_SAFE_TO_IGNORE} from './common.js';

const ROOT_SESSION = "browser";
// actually we use 'tot' but in chrome.debugger.attach 'tot' is 
// not a supported version string
const VERSION = "1.3"; 
const MESSAGES = new Map();

function promisify(context, name, err) {
  return async function(...args) {
    let resolver, rejector;
    const pr = new Promise((res,rej) => ([resolver, rejector] = [res,rej]));

    args.push(promisifiedCallback);

    context[name](...args);

    return pr;

    function promisifiedCallback(...result) {
      let error = err(name);
      if ( !! error ) {
        return rejector(error);    
      }
      return resolver(...result);
    }
  }
}

let Ws, Fetch;

async function loadDependencies() {
  if ( context == 'extension' ) {
    // no need to do anything here 
  } else if ( context == 'node' ) {
    const {default:ws} = await import('ws');
    const {default:nodeFetch} = await import('node-fetch');

    Ws = ws;
    Fetch = nodeFetch;
  }
}

export async function connect({port:port = 9222} = {}) {
  if ( ! Ws || ! Fetch ) {
    await loadDependencies();
  }
  try {
    const {webSocketDebuggerUrl} = await Fetch(`http://localhost:${port}/json/version`).then(r => r.json());
    const socket = new Ws(webSocketDebuggerUrl);
    const Resolvers = {};
    const Handlers = {};
    socket.on('message', handle);
    let id = 0;

    let resolve;
    const promise = new Promise(res => resolve = res);

    socket.on('open', () => resolve());

    await promise;

    return {
      send,
      on, ons,
      close
    }
    
    async function send(method, params = {}, sessionId) {
      const message = {
        method, params, sessionId, 
        id: ++id
      };
      if ( ! sessionId ) {
        delete message[sessionId];
      }
      const key = `${sessionId||ROOT_SESSION}:${message.id}`;
      let resolve;
      const promise = new Promise(res => resolve = res);
      Resolvers[key] = resolve;
      const outGoing = JSON.stringify(message);
      MESSAGES.set(key, outGoing);
      socket.send(outGoing);
      DEBUG && (SHOW_FETCH || !method.startsWith('Fetch')) && console.log("Sent", message);
      return promise;
    }

    async function handle(message) {
      const stringMessage = message;
      message = JSON.parse(message);
      if ( message.error ) {
        const showError = DEBUG || !ERROR_CODE_SAFE_TO_IGNORE.has(message.error.code);
        if ( showError ) {
          console.warn(message);
        }
      }
      const {sessionId} = message;
      const {method, params} = message;
      const {id, result} = message;

      if ( id ) {
        const key = `${sessionId||ROOT_SESSION}:${id}`;
        const resolve = Resolvers[key];
        if ( ! resolve ) {
          console.warn(`No resolver for key`, key, stringMessage.slice(0,140));
        } else {
          Resolvers[key] = undefined;
          try {
            await resolve(result);
          } catch(e) {
            console.warn(`Resolver failed`, e, key, stringMessage.slice(0,140), resolve);
          }
        }
        if ( DEBUG ) {
          if ( message.error ) {
            const showError = DEBUG || !ERROR_CODE_SAFE_TO_IGNORE.has(message.error.code);
            if ( showError ) {
              const originalMessage = MESSAGES.get(key);
              console.warn({originalMessage});
            }
          }
        }
        MESSAGES.delete(key);
      } else if ( method ) {
        const listeners = Handlers[method];
        if ( Array.isArray(listeners) ) {
          for( const func of listeners ) {
            try {
              func({message, sessionId});
            } catch(e) {
              console.warn(`Listener failed`, method, e, func.toString().slice(0,140), stringMessage.slice(0,140));
            }
          }
        }
      } else {
        console.warn(`Unknown message on socket`, message);
      }
    }

    function on(method, handler) {
      let listeners = Handlers[method]; 
      if ( ! listeners ) {
        Handlers[method] = listeners = [];
      }
      listeners.push(wrap(handler));
    }

    function ons(method, handler) {
      let listeners = Handlers[method]; 
      if ( ! listeners ) {
        Handlers[method] = listeners = [];
      }
      listeners.push(handler);
    }

    function close() {
      socket.close();
    }

    function wrap(fn) {
      return ({message, sessionId}) => fn(message.params)
    }
  } catch(e) {
    console.log("Error communicating with browser", e);
    process.exit(1);
  }
}
