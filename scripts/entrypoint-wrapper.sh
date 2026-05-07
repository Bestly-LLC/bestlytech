#!/bin/bash
# /custom-config/entrypoint-wrapper.sh on the Pi (cloud.bestly.tech).
#
# Container entrypoint for nextcloud-app. Runs as root (container default).
# Handles: custom Apache config + Bestly bootstrap + Nextcloud's real entrypoint.
set -u
/custom-config/apache-custom.sh
/custom-config/bestly-bootstrap.sh
exec /entrypoint.sh "$@"
