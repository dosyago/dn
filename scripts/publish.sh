#!/usr/bin/env bash

./scripts/go_build.sh
gpush minor "$@"
./scripts/go_dev.sh

