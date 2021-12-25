import fuzzy from './fuzzy.js';

console.log(fuzzy);

const doc = 'Meghan Markle requested this unexpected Christmas present for Archie from the Queen';
console.log(fuzzy(doc, 'Queen'));
