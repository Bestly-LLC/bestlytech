# Studio inbox faces (2026-10-15)
A sender we have a photo for shows it in the Studio inbox row instead of the grey initial. Elizabeth (elizabethobrienlpc@gmail.com) is the first.
`patch_index.py` is the exact-once patch on live index 59dc1f5064 (usage: `python3 patch_index.py live.html new.html`); it inlines `elizabeth-96.jpg` as a data URI.
The initial comes back if the photo fails to load. To add someone, add their address to `IB_FACES`.

Live row 7f49f9a9-40b5-4fba-9af9-4986e746469e (index app/index.2bd3303397.html).
Rollback row 36936e63-c6b8-4877-8145-7ff1ee2442a9: `update studio_builds set status=case when id='36936e63-c6b8-4877-8145-7ff1ee2442a9' then 'live' else 'superseded' end where id in ('36936e63-c6b8-4877-8145-7ff1ee2442a9','7f49f9a9-40b5-4fba-9af9-4986e746469e');` then check count(live)=1.
