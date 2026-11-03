#!/bin/sh
# WINGSWAP deploy: backs up and installs wall.new.html on Hestia
set -e
T=$(date +%H%M%S)
scp -o BatchMode=yes wall.new.html pi@192.168.1.211:/tmp/wall.wingswap.html
ssh -o BatchMode=yes pi@192.168.1.211 "cp /opt/bestly/wall/www/wall.html /opt/bestly/wall/www/wall.html.bak_wingswap_$T && grep -c WINGSWAP_20261103 /tmp/wall.wingswap.html && cp /tmp/wall.wingswap.html /opt/bestly/wall/www/wall.html && ls -la /opt/bestly/wall/www/wall.html*wingswap*"
