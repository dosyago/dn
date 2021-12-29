import {DEBUG as debug} from '../src/common.js';

const DEBUG = debug || true;

export function getInjection({sessionId}) {
  // Notes:
    // say() function
      // why aliased? Resistant to page overwriting
      // just a precaution as we are already in an isolated world here, but this makes
      // this script more portable if it were introduced globally as well as robust 
      // against API or behaviour changes of the browser or its remote debugging protocol
      // in future
  return `
    {
      const DEBUG = ${DEBUG};
      const MIN_CHECK_TEXT = 3000;  // min time between checking documentElement.innerText
      const MIN_NOTIFY = 5000;      // min time between telling controller text maybe changed
      const MAX_NOTIFICATIONS = 13; // max times we will tell controller text maybe changed
      const OBSERVER_OPTS = {
        subtree: true,
        childList: true,
        characterData: true
      };
      const Top = globalThis.top;
      let lastInnerText;

      if ( Top === globalThis ) {
        const ConsoleInfo = console.info.bind(console);
        const JSONStringify = JSON.stringify.bind(JSON);
        const TITLE_CHANGES = 10;
        const INITIAL_CHECK_TIME = 500;
        const TIME_MULTIPLIER = Math.E;
        const sessionId = "${sessionId}";
        const sleep = ms => new Promise(res => setTimeout(res, ms));
        const handler = throttle(handleFrameMessage, MIN_NOTIFY);
        let count = 0;

        installTop();

        async function installTop() {
          console.log("Installing in top frame...");
          self.startUrl = location.href;
          say({install: { sessionId, startUrl }});
          await sleep(500);
          beginTitleChecks();
          beginTextNotifications();
          console.log("Installed.");
        }

        function beginTitleChecks() {
          let lastTitle = null;
          let checker;
          let timeToNextCheck = INITIAL_CHECK_TIME;
          let changesLogged = 0;

          check();
          console.log('Begun logging title changes.');

          function check() {
            clearTimeout(checker);
            const currentTitle = document.title; 
            if ( lastTitle !== currentTitle ) {
              say({titleChange: {lastTitle, currentTitle, url: location.href, sessionId}});
              lastTitle = currentTitle;
              changesLogged++;
            } else {
              // increase check time if there's no change
              timeToNextCheck *= TIME_MULTIPLIER;
            }
            if ( changesLogged < TITLE_CHANGES ) {
              checker = setTimeout(check, timeToNextCheck);
            } else {
              console.log('Finished logging title changes.'); 
            }
          }
        }

        function say(thing) {
          ConsoleInfo(JSONStringify(thing));
        }

        function beginTextNotifications() {
          // listen for {textChanged:true} messages
          // throttle them
          // on leading throttle edge send message to controller with 
          // console.info(JSON.stringify({textChanged:true}));
          self.addEventListener('message', messageParser);

          console.log('Begun notifying of text changes.');

          function messageParser({data, origin}) {
            let source;
            try {
              ({source} = data.frameTextChangedNotification);
              if ( count > MAX_NOTIFICATIONS ) {
                self.removeEventListener('message', messageParser);
                return;
              }
              count++;
              handler({textChanged:{source}});
            } catch(e) {
              DEBUG && console.warn('could not parse message', data, e);
            }
          }
        }

        function handleFrameMessage({textChanged}) {
          const {source} = textChanged;
          console.log('Telling controller that text changed');
          say({textChanged:true, source, count});
        }
      } 

      beginTextMutationChecks();

      function beginTextMutationChecks() {
        // create mutation observer for text
        // throttle output

        const observer = new MutationObserver(check, /*throttle(check, MIN_CHECK_TEXT)*/);
        observer.observe(document.documentElement || document, OBSERVER_OPTS);

        console.log('Begun observing text changes.');
        
        function check() {
          console.log('check');
          const textMutated = document.documentElement.innerText !== lastInnerText;
          if ( textMutated ) {
            DEBUG && console.log('Text changed');
            lastInnerText = document.documentElement.innerText;
            Top.postMessage({frameTextChangedNotification:{source:location.href}}, '*');
          }
        }
      }

      // javascript throttle function
		  // source: https://stackoverflow.com/a/59378445	
			function throttle(func, timeFrame) {
				var lastTime = 0;
				return function (...args) {
					var now = new Date();
					if (now - lastTime >= timeFrame) {
						func.apply(this, args);
						lastTime = now;
					}
				};
			}
    }
  `;
}
