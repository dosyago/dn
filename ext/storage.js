export async function load(key) {
  if ( key == null || key == undefined ) {
    throw new Error(`load cannot be used to get everything.`);
  }

  let resolver;
  const promise = new Promise(res => resolver = res);
 
  chrome.storage.local.get(key, items => {
    resolver.call(null, items[key]);
  });

  return promise;
}

export async function save(key, value) {
  let resolver;
  const promise = new Promise(res => resolver = res);
 
  chrome.storage.local.set({[key]:value}, () => {
    if ( chrome.runtime.lastError ) {
      throw chrome.runtime.lastError;
    }
    resolver.call();
  });

  return promise;
}

