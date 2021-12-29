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
      if ( top === self ) {
        const ConsoleInfo = console.info.bind(console);
        const JSONStringify = JSON.stringify.bind(JSON);
        const TITLE_CHANGES = 10;
        const INITIAL_CHECK_TIME = 500;
        const TIME_MULTIPLIER = Math.E;
        const sessionId = "${sessionId}";
        const sleep = ms => new Promise(res => setTimeout(res, ms));

        installTop();

        async function installTop() {
          console.log("Installing in top frame...");
          self.startUrl = location.href;
          say({install: { sessionId, startUrl }});
          await sleep(500);
          beginTitleChecks();
          beginTextChecks();
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

        function beginTextChecks() {
          // listen for {textChanged:true} messages
          // throttle them
          // on leading throttle edge send message to controller with 
          // console.info(JSON.stringify({textChanged:true}));
          self.addEventListener('message', ({data, origin}) => {
            try {
              
            } catch(e) {

            }
          });
        }
      } 

      function beginDocumentMutationChecks() {
        // create mutation observer for text
        // throttle output
        // on leading throttle edge send top.postMessage({textChanged:true}, '*');
      }

      // javascript throttle function

    }
  `;
}
