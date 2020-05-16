# :classical_building: [22120](https://github.com/dosyago/22120) ![npm downloads](https://img.shields.io/npm/dt/archivist1?label=npm%20downloads) ![binary downloads](https://img.shields.io/github/downloads/dosyago/22120/total?label=binary%20downloads) [![latest package](https://img.shields.io/github/v/release/dosyago/22120?label=latest%20release)](https://github.com/dosyago/22120/releases)

:classical_building: - An archivist browser controller that caches everything you browse, a library server with full text search to serve your archive. 

Already a user? [Would it be impossible to share what you think on this feedback form?](https://forms.gle/san6sZT6B9PN52K38)

**This project literally makes your web browsing available COMPLETELY OFFLINE.** Your browser does not even know the difference. It's literally that amazing. Yes. 

Save your browsing, then switch off the net and go to `http://localhost:22120` and switch mode to **serve** then browse what you browsed before. It all still works.

**warning: if you have Chrome open, it will close it automatically when you open 22120, and relaunch it. You may lose any unsaved work.**

## Get 22120

3 ways to get it:

1. Get binary from the [releases page.](https://github.com/dosyago/22120/releases), or
2. Run with npx: `npx archivist1`, or 
3. Clone this repo and run as a Node.JS app: `npm i && npm start` 

Also, coming soon is a Chrome Extension.

## Using

### Pick save mode or serve mode

Go to http://localhost:22120 in your browser, 
and follow the instructions. 

### Exploring your 22120 archive

Archive will be located in `$your_user_home_directory/22120-arc/public/library`

But it's not public, don't worry!

## Format

The archive format is:

`22120-arc/public/library/<resource-origin>/<sha1-path-hash>.json`

Inside the JSON file, is a JSON object with headers, response code, key and a base 64 encoded response body.

## How it works

Uses DevTools protocol to intercept all requests, and caches responses against a key made of (METHOD and URL) onto disk. It also maintains an in memory set of keys so it knows what it has on disk. 

## FAQ

### Can I use this with a browser that's not Chrome-based? 

No.

### How does this interact with Ad blockers?

Interacts just fine. The things ad blockers stop will not be archived.

### How secure is running chrome with remote debugging port open?

Seems pretty secure. It's not exposed to the public internet, and pages you load that tried to use it cannot use the protocol for anything (except to open a new tab, which they can do anyway). 

### Is this free?

Yes this is totally free to download and use. It's also open source so do what you want with it.

### What's the roadmap?

- Full text search 
- Library server to serve archive publicly.
- Distributed p2p web browser on IPFS

### What about streaming content?

The following are probably hard (and I haven't thought much about):

- Streaming content (audio, video)
- "Impure" request response pairs (such as if you call GET /endpoint 1 time you get "A", if you call it a second time you get "AA", and other examples like this).
- WebSockets (how to capture and replay that faithfully?)

Probably some way to do this tho.

### Can I black list domains to not archive them?

Yes! Put any domains into `$HOME/22120-arc/no.json`, eg:

```json
[
  "*.google.com",
  "*.cnn.co?"
]
```

Will not cache any resource with a host matching those. Wildcards: 

- `*` (0 or more anything) and 
- `?` (0 or 1 anything) 

### Is there a DEBUG mode for troubleshooting?

Yes, just make sure you set an environment variable called `DEBUG_22120` to anything non empty.

So for example in posix systems:

```bash
export DEBUG_22120=True
```

### Can I change the archive path?

Yes, there's a control for changing the archive path in the control page: http://localhost:22120

### Can I change this other thing?

There's a few command line arguments. You'll see the format printed as the first printed line when you start the program.

For other things you can examine the source code. 


