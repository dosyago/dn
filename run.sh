#!/usr/bin/env bash

phys=$(free -t -m | grep -oP '\d+' | sed '10!d')
alloc=$(echo "$phys * 90/100" | bc )
echo $alloc
node --max-old-space-size=$alloc src/app.js
