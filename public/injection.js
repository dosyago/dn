export function getInjection({sessionId}) {
  return `
    {
      if ( top === self ) {
        const sessionId = "${sessionId}";
        const sleep = ms => new Promise(res => setTimeout(res, ms));

        install();

        async function install() {
          console.log("Installing...");
          console.info(JSON.stringify({installed: { sessionId, startUrl: location.href }}));
          await sleep(500);
          //alert("Hello there");
          //console.log("Hello there");
          //setInterval(() => document.title = `[INSTALLED]`);
        }
      }
    }
  `;
}
