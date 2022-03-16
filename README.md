# :floppy_disk: [DiskerNet](https://github.com/c9fe/22120) [![source lines of code](https://sloc.xyz/github/crisdosyago/Diskernet)](https://sloc.xyz) [![npm downloads (22120)](https://img.shields.io/npm/dt/archivist1?label=npm%20downloads%20%2822120%29)](https://npmjs.com/package/archivist1) [![npm downloads (diskernet, since Jan 2022)](https://img.shields.io/npm/dt/diskernet?label=npm%20downloads%20%28diskernet%2C%20since%20Jan%202022%29)](https://npmjs.com/package/diskernet) [![binary downloads](https://img.shields.io/github/downloads/c9fe/22120/total?label=OS%20binary%20downloads)](https://GitHub.com/crisdosyago/DiskerNet/releases) [![visitors+++](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Fc9fe%2F22120&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=%28today%2Ftotal%29%20visitors%2B%2B%2B%20since%20Oct%2027%202020&edge_flat=false)](https://hits.seeyoufarm.com) ![version](https://img.shields.io/npm/v/archivist1)

:floppy_disk: - an internet on yer Disk

**DiskerNet** (codename *PROJECT 22120*) is an archivist browser controller that caches everything you browse, a library server with full text search to serve your archive. 

**Now with full text search over your archive.** 

This feature is just released in version 2 so it will improve over time.

## And one more thing...

**Coming to a future release, soon!**: The ability to publish your own search engine that you curated with the best resources based on your expert knowledge and experience.

## Get it

[Download a release](https://github.com/crisdosyago/Diskernet/releases)

or ...

**Get it on [npm](https://www.npmjs.com/package/diskernet):**

```sh
$ npm i -g diskernet@latest
```

or...

**Build your own binaries:**

```sh
$ git clone https://github.com/crisdosyago/DiskerNet
$ cd DiskerNet
$ npm i 
$ ./scripts/build_setup.sh
$ ./scripts/compile.sh
$ cd bin/
```

<span id=toc></span>
----------------
- [Overview](#classical_building-22120---)
  * [License](#license)
  * [About](#about)
  * [Get 22120](#get-22120)
  * [Using](#using)
    + [Pick save mode or serve mode](#pick-save-mode-or-serve-mode)
    + [Exploring your 22120 archive](#exploring-your-22120-archive)
  * [Format](#format)
  * [Why not WARC (or another format like MHTML) ?](#why-not-warc-or-another-format-like-mhtml-)
  * [How it works](#how-it-works)
  * [FAQ](#faq)
    + [Do I need to download something?](#do-i-need-to-download-something)
    + [Can I use this with a browser that's not Chrome-based?](#can-i-use-this-with-a-browser-thats-not-chrome-based)
    + [How does this interact with Ad blockers?](#how-does-this-interact-with-ad-blockers)
    + [How secure is running chrome with remote debugging port open?](#how-secure-is-running-chrome-with-remote-debugging-port-open)
    + [Is this free?](#is-this-free)
    + [What if it can't find my chrome?](#what-if-it-cant-find-my-chrome)
    + [What's the roadmap?](#whats-the-roadmap)
    + [What about streaming content?](#what-about-streaming-content)
    + [Can I black list domains to not archive them?](#can-i-black-list-domains-to-not-archive-them)
    + [Is there a DEBUG mode for troubleshooting?](#is-there-a-debug-mode-for-troubleshooting)
    + [Can I version the archive?](#can-i-version-the-archive)
    + [Can I change the archive path?](#can-i-change-the-archive-path)
    + [Can I change this other thing?](#can-i-change-this-other-thing)

------------------

## License 

22120 is licensed under Polyform Strict License 1.0.0 (no modification, no distribution). You can purchase a license for different uses below:


-  for personal, research, noncommercial purposes: 
[Buy a Perpetual Non-commercial Use License of the current Version re-upped Monthly to the Latest Version, USD$1.99 per month](https://buy.stripe.com/fZeg0a45zdz58U028z) [Read license](https://github.com/DOSYCORPS/polyform-licenses/blob/1.0.0/PolyForm-Noncommercial-1.0.0.md)
- for part of your internal tooling in your org: [Buy a Perpetual Internal Use License of the current Version re-upped Monthly to the Latest Version, USD $12.99 per month](https://buy.stripe.com/00g4hsgSlbqXb288wY) [Read license](https://github.com/DOSYCORPS/polyform-licenses/blob/1.0.0/PolyForm-Internal-Use-1.0.0.md)
- for anywhere in your business: [Buy a Perpetual Small-medium Business License of the current Version re-upped Monthly to the Latest Version, USD $99 per month](https://buy.stripe.com/aEUbJUgSl2UreekdRj) [Read license](https://github.com/DOSYCORPS/polyform-licenses/blob/1.0.0/PolyForm-Small-Business-1.0.0.md)

<p align=right><small><a href=#toc>Top</a></small></p>

## About

**This project literally makes your web browsing available COMPLETELY OFFLINE.** Your browser does not even know the difference. It's literally that amazing. Yes. 

Save your browsing, then switch off the net and go to `http://localhost:22120` and switch mode to **serve** then browse what you browsed before. It all still works.

**warning: if you have Chrome open, it will close it automatically when you open 22120, and relaunch it. You may lose any unsaved work.**

<p align=right><small><a href=#toc>Top</a></small></p>

## Get 22120

3 ways to get it:

1. Get binary from the [releases page.](https://github.com/c9fe/22120/releases), or
2. Run with npx: `npx diskernet@latest`, or
    - `npm i -g diskernet@latest && exlibris`
3. Clone this repo and run as a Node.JS app: `npm i && npm start` 

<p align=right><small><a href=#toc>Top</a></small></p>

## Using

### Pick save mode or serve mode

Go to http://localhost:22120 in your browser, 
and follow the instructions. 

<p align=right><small><a href=#toc>Top</a></small></p>

### Exploring your 22120 archive

Archive will be located in `22120-arc/public/library`\*

But it's not public, don't worry!

You can also check out the archive index, for a listing of every title in the archive. The index is accessible from the control page, which by default is at [http://localhost:22120](http://localhost:22120) (unless you changed the port).

\**Note:`22120-arc` is the archive root of a single archive, and by defualt it is placed in your home directory. But you can change the parent directory for `22120-arc` to have multiple archvies.*

<p align=right><small><a href=#toc>Top</a></small></p>

## Format

The archive format is:

`22120-arc/public/library/<resource-origin>/<path-hash>.json`

Inside the JSON file, is a JSON object with headers, response code, key and a base 64 encoded response body.

<p align=right><small><a href=#toc>Top</a></small></p>

## Why not WARC (or another format like MHTML) ?

**The case for the 22120 format.**

Other formats (like MHTML and SingleFile) save translations of the resources you archive. They create modifications, such as altering the internal structure of the HTML, changing hyperlinks and URLs into "flat" embedded data URIs, or local references, and require other "hacks" in order to save a "perceptually similar" copy of the archived resource.

22120 throws all that out, and calls rubbish on it. 22120 saves a *verbatim* **high-fidelity** copy of the resources your archive. It does not alter their internal structure in any way. Instead it records each resource in its own metadata file. In that way it is more similar to HAR and WARC, but still radically different. Compared to WARC and HAR, our format is radically simplified, throwing out most of the metadata information and unnecessary fields these formats collect.

**Why?**

At 22120, we believe in the resources and in verbatim copies. We don't annoint ourselves as all knowing enough to modify the resource source of truth before we archive it, just so it can "fit the format* we choose. We don't believe we need to decorate with obtuse and superfluous metadata. We don't believe we should be modifying or altering resources we archive. We belive we should save them exactly as they were presented. We believe in simplicity. We believe the format should fit (or at least accommodate, and be suited to) the resource, not the other way around. We don't believe in conflating **metadata** with **content**; so we separate them. We believe separating metadata and content, and keeping the content pure and altered throughout the archiving process is not only the right thing to do, it simplifies every part of the audit trail, because we know that the modifications between archived copies of a resource of due to changes to the resources themselves, not artefacts of the format or archiving process.

Both SingleFile and MHTML require mutilatious modifications of the resources so that the resources can be "forced to fit" the format. At 22120, we believe this is not required (and in any case should never be performed). We see it as akin to lopping off the arms of a Roman statue in order to fit it into a presentation and security display box. How ridiculous! The web may be a more "pliable" medium but that does not mean we should treat it without respect for its inherent content. 

**Why is changing the internal structure of resources so bad?**

In our view, the internal structure of the resource as presented, *is the cannon*. Internal structure is not just substitutable "presentation" - no, in fact it encodes vital semantic information such as hyperlink relationships, source choices, and the "strokes" of the resource author as they create their content, even if it's mediated through a web server or web framework. 

**Why else is 22120 the obvious and natural choice?**

22120 also archives resources exactly as they are sent to the browser. It runs connected to a browser, and so is able to access the full-scope of resources (with, currently, the exception of video, audio and websockets, for now) in their highest fidelity, without modification, that the browser receives and is able to archive them in the exact format presented to the user. Many resources undergo presentational and processing changes before they are presented to the user. This is the ubiquitous, "web app", where client-side scripting enabled by JavaScript, creates resources and resource views on the fly. These sorts of "hyper resources" or "realtime" or "client side" resources, prevalent in SPAs, are not able to be archived, at least not utilizing the normal archive flow, within traditional `wget`-based archiving tools. 

In short, the web is an *online* medium, and it should be archived and presented in the same fashion. 22120 archives content exactly as it is received and presented by a browser, and it also replays that content exactly as if the resource were being taken from online. Yes, it requires a browser for this exercise, but that browser need not be connected to the internet. It is only natural that viewing a web resource requires the web browser. And because of 22120 the browser doesn't know the difference! Resources presented to the browser form a remote web site, and resources given to the browser by 22120, are seen by the browser as ***exactly the same.*** This ensures that the people viewing the archive are also not let down and are given the change to have the exact same experience as if they were viewing the resource online. 

<p align=right><small><a href=#toc>Top</a></small></p>

## How it works

Uses DevTools protocol to intercept all requests, and caches responses against a key made of (METHOD and URL) onto disk. It also maintains an in memory set of keys so it knows what it has on disk. 

<p align=right><small><a href=#toc>Top</a></small></p>

## FAQ

### Do I need to download something?

Yes. But....If you like **22120**, you might love the clientless hosted version coming in future. You'll be able to build your archives online from any device, without any download, then download the archive to run on any desktop. You'll need to sign up to use it, but you can jump the queue and sign up [today](https://dosyago.com).

### Can I use this with a browser that's not Chrome-based? 

No. 

<p align=right><small><a href=#toc>Top</a></small></p>

### How does this interact with Ad blockers?

Interacts just fine. The things ad blockers stop will not be archived.

<p align=right><small><a href=#toc>Top</a></small></p>

### How secure is running chrome with remote debugging port open?

Seems pretty secure. It's not exposed to the public internet, and pages you load that tried to use it cannot use the protocol for anything (except to open a new tab, which they can do anyway). It seems there's a potential risk from malicious browser extensions, but we'd need to confirm that and if that's so, work out blocks. See [this useful security related post](https://github.com/c9fe/22120/issues/67) for some info.

<p align=right><small><a href=#toc>Top</a></small></p>

### Is this free?

Yes this is totally free to download and use for personal non-commercial use. If you want to modify or distribute it, or use it commercially (either internally or for customer functions) you need to purchase a [Noncommercial, internal use, or SMB license](#license). 

<p align=right><small><a href=#toc>Top</a></small></p>

### What if it can't find my chrome?

See this useful [issue](https://github.com/c9fe/22120/issues/68).

<p align=right><small><a href=#toc>Top</a></small></p>

### What's the roadmap?

- Full text search ✅
- Library server to serve archive publicly.
- Distributed p2p web browser on IPFS

<p align=right><small><a href=#toc>Top</a></small></p>

### What about streaming content?

The following are probably hard (and I haven't thought much about):

- Streaming content (audio, video)
- "Impure" request response pairs (such as if you call GET /endpoint 1 time you get "A", if you call it a second time you get "AA", and other examples like this).
- WebSockets (how to capture and replay that faithfully?)

Probably some way to do this tho.

<p align=right><small><a href=#toc>Top</a></small></p>

### Can I black list domains to not archive them?

Yes! Put any domains into `22120-arc/no.json`\*, eg:

```json
[
  "*.horribleplantations.com",
  "*.cactusfernfurniture.com",
  "*.gustymeadows.com",
  "*.nytimes.com",
  "*.cnn.co?"
]
```

Will not cache any resource with a host matching those. Wildcards: 

- `*` (0 or more anything) and 
- `?` (0 or 1 anything) 

\**Note: the `no` file is per-archive. `22120-arc` is the archive root of a single archive, and by defualt it is placed in your home directory. But you can change the parent directory for `22120-arc` to have multiple archvies, and each archive requires its own `no` file, if you want a blacklist in that archive.*

<p align=right><small><a href=#toc>Top</a></small></p>

### Is there a DEBUG mode for troubleshooting?

Yes, just make sure you set an environment variable called `DEBUG_22120` to anything non empty.

So for example in posix systems:

```bash
export DEBUG_22120=True
```

<p align=right><small><a href=#toc>Top</a></small></p>

### Can I version the archive?

Yes! But you need to use `git` for versioning. Just initiate a git repo in your archive repository. And when you want to save a snapshot, make a new git commit.

<p align=right><small><a href=#toc>Top</a></small></p>

### Can I change the archive path?

Yes, there's a control for changing the archive path in the control page: http://localhost:22120

<p align=right><small><a href=#toc>Top</a></small></p>

### Can I change this other thing?

There's a few command line arguments. You'll see the format printed as the first printed line when you start the program.

For other things you can examine the source code. 

<p align=right><small><a href=#toc>Top</a></small></p>

