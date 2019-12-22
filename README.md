# 22120

:classical_building: - An archivist browser controller that caches everything you browse, a library server with full text search to serve your archive. 

## Running

### Save your stuff

1. Open your browser with `--remote-debugging-port=9222` 
2. Clone this repo and inside its directory run `npm i && npm run save`

### Serve your stuff

1. Open your browser with `--remote-debugging-port=9222` 
2. Inside the repo directory run `npm run serve`
3. Browse what you browsed before (you can switch off internet and it still works).

### Can I use this with a browser that's not Chrome-based?

:fearful: *[For protocol status and instructions opening remote debugging for Firefox and Edge, see this section.](#more-instructions)*


## Initial goal

Proof of concept of the ability to browse and transparently save everything, then switch off internet and browse it later as if you were still online.

Inspired by people talking about enriching bookmarks and browser history with the ability to save all your browsing data and search it, even independent of you being online or the site being online.

## How it works

Uses DevTools protocol to intercept all requests, and caches responses against a key made of (METHOD and URL) into an in memory map which it saves to disk every 10 seconds.

## So far

- The library server hasn't been implemented.
- Only saving and serving with the archivist works. 
- You can use it by opening your browser with `--remote-debugging-port=9222` then running `npm run save`. Everything you browser will be saved to `cache.json`
- You can switch off your internet and run `npm run serve` (also with your browser on remote debugging) and browser everything you just saved as normal.

## Future

- Implement library server so we can actually save the responses to disk in the "file tree structure" of the site you browse, then serve it, and also index and search it. This will involve also serving request/response metadata and converting between the request/response format and a file format. 
- The idea is that you can browse a site and end up with a static directory structure of assets that you can then serve on a local static server and browse it basically as normal. 
- Generally improve code and efficiency.

## The goal

To build a personal archive that you can search and use that does not depend on the continued existence of those sites, or on having internet, but that works just like you are browsing them.

## Stuff that will probably be hard (and I haven't thought much about)

- Streaming content (audio, video)
- "Impure" request response pairs (such as if you call GET /endpoint 1 time you get "A", if you call it a second time you get "AA", and other examples like this).
- WebSockets (how to capture and replay that faithfully?)

There are probably "good enough" solutions to all these, and likely some or all of them already exist and have been thought up by other smart people.

### More Instructions

- For opening remote debugging in Edge, [click here](https://docs.microsoft.com/en-us/microsoft-edge/devtools-protocol/) and also [see here that Edge's protocol does not currently support the 'Fetch' domain used by this project](https://docs.microsoft.com/en-us/microsoft-edge/devtools-protocol/0.2/http)
- For opening remote debugging in Firefox, [click here](https://developer.mozilla.org/en-US/docs/Tools/Remote_Debugging) and also [see here that the protocol currently only ships in Firefox Nightly](https://firefox-source-docs.mozilla.org/remote/Usage.html) and also [see that Firefox's protocol does not fully support the 'Fetch' domain used by the project](https://bugzilla.mozilla.org/buglist.cgi?product=Remote%20Protocol&component=Fetch&resolution=---)
- For possible options for Safari, [take a look here](https://github.com/google/ios-webkit-debug-proxy)

## Higher level description

Basically this is like a "full spectrum record" of your browsing history, with all assets and their content saved. It's like going on holiday and taking a GoPro that saves everything you look at, except that the quality is such that when you replay it, it's actually the same as experiencing it the first time.


