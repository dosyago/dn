#!/usr/bin/env bash

./scripts/go_build.sh
gpush "$@"
./scripts/go_dev.sh

