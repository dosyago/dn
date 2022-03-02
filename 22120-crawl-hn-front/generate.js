#!/usr/bin/env node

const count = parseInt(process.argv[2]);

if ( Number.isNaN(count) ) {
  throw new TypeError(`First argument needs to be a number.
    It determines how many days back in the past we generate 
    HN front page links for
  `);
}

const today = new Date();

console.log(HNFrontURL(today));
let newDay = new Date(today);
let i = 1;

while(i < count) {
  newDay.setDate(newDay.getDate()-1);
  console.log(HNFrontURL(newDay));
  i++;
}

function HNFrontURL(date) {
  const dateString = date.toISOString().split('T')[0];
  return `https://news.ycombinator.com/front?day=${dateString}`;
}
