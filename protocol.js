import {context} from './common.js';

const ROOT_SESSION = "browser";
// actually we use 'tot' but in chrome.debugger.attach 'tot' is 
// not a supported version string
const VERSION = "1.3"; 

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
  if ( context == 'extension' ) {
    const Handlers = {};
    const getTargets = promisify(chrome.debugger, 'getTargets', guardError);
    const attach = promisify(chrome.debugger, 'attach', guardError);
    const sendCommand = promisify(chrome.debugger, 'sendCommand', guardError);
    let resp, firstTarget, targets;

    chrome.debugger.onEvent.addListener(handle);

    // attach to all existing targets 
      targets = await getTargets();
      targets = targets.filter(T => T.type == 'page' && T.url.startsWith('http'));

      for ( const T of targets ) {
        if ( ! T.attached ) {
          resp = await attach({targetId:T.id}, VERSION);
          console.log("attached", {resp});
        }
      }

      if ( targets.length ) {
        firstTarget = targets[0].id;
      }

      await confirmAllAttached();

    // discover targets is blocked in extensions
      // instead we manually discover via tabs onCreated

      let nextAttachConfirmation;

      chrome.tabs.onCreated.addListener(async Tab => {
        console.log(Tab);
        const url = Tab.url || Tab.pendingUrl;
        const attachable = url.startsWith('about') || url.startsWith('http');
        if ( attachable ) {
          const target = {tabId:Tab.id};
          const r = await attach(target, VERSION);
          if ( ! firstTarget ) {
            firstTarget = Tab.id;
          }
          console.log("attach", {resp:r});
        }
        if ( nextAttachConfirmation ) {
          clearTimeout(nextAttachConfirmation);
        }
        nextAttachConfirmation = setTimeout(confirmAllAttached, 200);
      });

      chrome.tabs.onUpdated.addListener(async (id, changed, Tab) => {
        const {url} = changed;
        const attachable = url && (url.startsWith('about') || url.startsWith('http'));
        if ( attachable && ! Tab.attached ) {
          const target = {tabId:id};
          const r = await attach(target, VERSION);
          if ( ! firstTarget ) {
            firstTarget = id;
          }
          console.log("attach", {resp:r});
        }
        if ( nextAttachConfirmation ) {
          clearTimeout(nextAttachConfirmation);
        }
        nextAttachConfirmation = setTimeout(confirmAllAttached, 200);
      });

    return {send, on};

    async function on(method, handler) {
      let listeners = Handlers[method]; 
      if ( ! listeners ) {
        Handlers[method] = listeners = [];
      }
      listeners.push(handler);
    }

    async function send(method, params = {}, id = firstTarget) {
      let tabId, targetId;
      if ( Number.isInteger(id) ) {
        tabId = id;
      } else if ( typeof id == "string" ) {
        targetId = id;
      } else {
        throw new Error(`Must specify an id to send command to. ${method}`);
      }
      try {
        return await sendCommand(
          {targetId, tabId}, 
          method, 
          params, 
        );
      } catch(e) {
        console.warn(`${method}`, e);
        return {error:e};
      }
    }

    async function handle(source, method, params) {
      const listeners = Handlers[method];
      if ( Array.isArray(listeners) ) {
        for( const func of listeners ) {
          try {
            await func(method, params, source);
          } catch(e) {
            console.warn(`Listener failed`, method, JSON.stringify(params), e, func.toString().slice(0,140));
          }
        }
      }
    }

    function guardError(prefix = '') {
      if ( chrome.runtime.lastError ) {
        if ( typeof prefix == 'object' ) {
          try {
            prefix = JSON.stringify(prefix, null, 2);
          } catch(e) {
            console.warn(e);
            prefix = prefix + '';
          }
        }
        const error = `${prefix}: ${chrome.runtime.lastError.message}`;
        return error;
      }
      return false;
    }

    async function confirmAllAttached() {
      resp = await getTargets();
      targets = resp.filter(T => T.type == 'page' && T.url.startsWith('http') && !T.attached);
      console.assert(targets.length == 0, "We are not attached to some attachable targets", targets);
    }
  } else if ( context == 'node' ) {
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
        socket.send(JSON.stringify(message));
        return promise;
      }

      async function handle(message) {
        const stringMessage = message;
        message = JSON.parse(message);
        if ( message.error ) {
          //console.warn(message);
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
  } else {
    throw new TypeError('Currently only supports running in Node.JS or as a Chrome Extension with Debugger permissions');
  }
}
