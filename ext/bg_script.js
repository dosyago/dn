import {save, load} from './storage.js';
import Archivist from '../archivist.js';
import {say} from '../common.js';

console.log("I am the background script.");
console.log({save, load, Archivist});

const {send, on} = Archivist.collect({mode:'save'});

