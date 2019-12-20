import fs from 'fs';
import ws from 'ws';
import fetch from 'node-fetch';

// cache is a simple set 
  // that holds the serialized requests
  // that are saved on disk
const Cache = new Set();

export default class Archivist {
}

async function collect({port}) {
  const {send, on, ons} = await connect({port});

  // send commands and listen to events
    // so that we can intercept every request
    // and cache it and if it's in cache then we
    // can pause the request (so it does not go to network)
    // and serve from cache
    // effectively off-lining the site
}

async function connect({port:port = 9222} = {}) {
  const {webSocketDebuggerUrl} = await fetch(`http://localhost:${port}/json/version`).then(r => r.json());
  const socket = new ws(webSocketDebuggerUrl);
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
}
