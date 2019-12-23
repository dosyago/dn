import {context} from './common.js';

const ROOT_SESSION = 'browser';

let Ws, Fetch;

console.log(context);
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
  if ( context == 'extension' ) {
    const Handlers = {};
    // we want to attach to all targets 

    let browserTarget;

    chrome.debugger.onEvent.addListener(handle);

    async function on(method, handler) {
      let listeners = Handlers[method]; 
      if ( ! listeners ) {
        Handlers[method] = listeners = [];
      }
      listeners.push(handler);
    }

    async function send(method, params = {}, sessionId) {
      let resolver;
      const promise = new Promise(res => resolver = res);
      chrome.debugger.sendCommand(
        {targetId:browserTarget}, 
        method, 
        params, 
        result => resolver.call(null, result)
      );
      return promise;
    }

    async function handle(source, method, params) {
      const listeners = Handlers[method];
      if ( Array.isArray(listeners) ) {
        for( const func of listeners ) {
          try {
            await func(method, params, source);
          } catch(e) {
            console.warn(`Listener failed`, method, e, func.toString().slice(0,140), stringMessage.slice(0,140));
          }
        }
      }
    }
  } else if ( context == 'node' ) {
    if ( ! Ws || ! Fetch ) {
      await loadDependencies();
    }
    const {webSocketDebuggerUrl} = await Fetch(`http://localhost:${port}/json/version`).then(r => r.json());
    const socket = new Ws(webSocketDebuggerUrl);
    const Resolvers = {};
    const Handlers = {};
    socket.on('message', handle);
    let id = 0;
    
    async function send(method, params = {}, sessionId) {
      const message = {
        method, params, sessionId, 
        id: ++id
      };
      const key = `${sessionId||ROOT_SESSION}:${message.id}`;
      let resolve;
      const promise = new Promise(res => resolve = res);
      Resolvers[key] = resolve; 
      socket.send(JSON.stringify(message));
      return promise;
    }

    async function handle(message) {
      const stringMessage = message;
      message = JSON.parse(message);
      if ( message.error ) {
        console.warn(message);
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
      } else if ( method ) {
        const listeners = Handlers[method];
        if ( Array.isArray(listeners) ) {
          for( const func of listeners ) {
            try {
              await func({message, sessionId});
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

    function wrap(fn) {
      return ({message, sessionId}) => fn(message.params)
    }

    let resolve;
    const promise = new Promise(res => resolve = res);

    socket.on('open', () => resolve());

    await promise;

    return {
      send,
      on, ons
    }
  } else {
    throw new TypeError('Currently only supports running in Node.JS or as a Chrome Extension with Debugger permissions');
  }
}
