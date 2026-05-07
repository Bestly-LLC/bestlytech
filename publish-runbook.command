#!/bin/bash
# Commit the DNS+cert+migration runbook so it lives in the repo.
set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock
git checkout main
git pull origin main
git add docs/dns-cert-migration-runbook.md
git commit -m "docs: DNS + cert + migration runbook

Captures findings from the post-P3 ops session:
  - cookieyeti.com is serving DreamHost's default sni.dreamhost.com
    cert (Let's Encrypt was never provisioned), not a chain problem
  - hoascope.com is a Namecheap parking page, never lived at DreamHost
  - app.hoascope.com is NXDOMAIN, no Vercel deployment exists to CNAME to
  - bestly.tech NS = Cloudflare, hoascope.com NS = Namecheap, cookieyeti
    NS = DreamHost

Plus exact runbook for status.bestly.tech subdomain wiring + the
strategic recommendation to migrate cookieyeti+hoascope to Vercel.
" || echo "nothing to commit"
git push origin main
echo ""
echo "Runbook published. View it at docs/dns-cert-migration-runbook.md"
sleep 5
