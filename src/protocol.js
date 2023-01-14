import Ws from 'ws';
import Fetch from 'node-fetch';
import {untilTrue, SHOW_FETCH, DEBUG, ERROR_CODE_SAFE_TO_IGNORE} from './common.js';

const ROOT_SESSION = "browser";
const MESSAGES = new Map();

export async function connect({port:port = 9222} = {}) {
  let webSocketDebuggerUrl, socket;
  try {
    await untilTrue(async () => {
      let result = false;
      try {
        const {webSocketDebuggerUrl} = await Fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
        if ( webSocketDebuggerUrl ) {
          result = true;
        }
      } finally {
        return result; 
      }
    });
    ({webSocketDebuggerUrl} = await Fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()));
    socket = new Ws(webSocketDebuggerUrl);
  } catch(e) {
    console.log("Error communicating with browser", e);
    process.exit(1);
  }

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
    on, ons, ona,
    close
  };
  
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
    if ( typeof message !== "string" ) {
      try {
        message += '';
      } catch(e) {
        message = message.toString();
      }
    }
    const stringMessage = message;
    message = JSON.parse(message);
    if ( message.error ) {
      const showError = DEBUG || !ERROR_CODE_SAFE_TO_IGNORE.has(message.error.code);
      if ( showError ) {
        console.warn(message);
      }
      console.warn(message);
    }
    const {sessionId} = message;
    const {method} = message;
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

  function ona(method, handler, sessionId) {
    let listeners = Handlers[method]; 
    if ( ! listeners ) {
      Handlers[method] = listeners = [];
    }
    listeners.push(({message}) => {
      if ( message.sessionId === sessionId ) {
        handler(message.params);
      } else {
        console.log(`No such`, {method, handler, sessionId, message});
      }
    });
  }

  function close() {
    socket.close();
  }

  function wrap(fn) {
    return ({message}) => fn(message.params)
  }
}
