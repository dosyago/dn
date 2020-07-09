{
  if ( top === self ) {
    const sleep = ms => new Promise(res => setTimeout(res, ms));

    install();

    async function install() {
      console.log("Opening an alert....");
      await sleep(3000);
      alert("Hello there");
    }
  }
}
