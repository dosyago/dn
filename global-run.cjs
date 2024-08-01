#!/usr/bin/env node

const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

if (!fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
  spawn('npm', ['i'], { stdio: 'inherit' });
}

// Getting the total system memory
const totalMemory = os.totalmem();

// Allocating 90% of the total memory
const memoryAllocation = Math.floor((totalMemory / (1024 * 1024)) * 0.8); // Converted bytes to MB and took 90% of it

console.log(`Index can use up to: ${memoryAllocation}MB RAM`);

// Running the application
spawn('node', [`--max-old-space-size=${memoryAllocation}`, path.resolve(__dirname, 'build', 'cjs', 'downloadnet.cjs')], { stdio: 'inherit' });

