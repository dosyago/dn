"use strict";
{
  const sleep = ms => new Promise(res => setTimeout(res, ms));

  install();

  async function install() {
    await sleep(3000);
    console.log("Opening an alert....");
    alert("Hello there");
  }
}
