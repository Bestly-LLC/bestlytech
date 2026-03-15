

# Replace Cookie Yeti Icons with Uploaded Images

## What changes

Replace the generic Snowflake/Puzzle icons with the uploaded Cookie Yeti app icon (yeti face) across three locations:

1. **Cookie Yeti product page hero** — swap `<Snowflake>` icon for the yeti face image
2. **Products dropdown** — swap `Puzzle` icon for the yeti face image
3. **Activation code email** — swap `❄️` emoji in the header for the yeti face image (hosted publicly)

## Files

| File | Change |
|------|--------|
| `src/assets/cookieyeti-icon.png` | Copy uploaded yeti face image here |
| `public/images/cookieyeti-icon.png` | Copy to public for email use |
| `src/pages/CookieYeti.tsx` | Import yeti icon, replace `<Snowflake>` in hero with `<img>` |
| `src/components/ProductsDropdown.tsx` | Add yeti icon as `image` entry instead of `Puzzle` icon |
| `supabase/functions/_shared/email-template.ts` | Replace `❄️` emoji in `activationCodeEmail` header with `<img>` pointing to published URL |

## Details

- The yeti face (`CookieYeti-icon.png`) is the app icon — used everywhere
- The foot (`CookieYeti_Icon_Foot.png`) is "just fluff" per user — not used
- For the email, reference the image from the published site: `https://bestlytech.lovable.app/images/cookieyeti-icon.png`
- In the Products dropdown, Cookie Yeti entry already supports `image` prop — just switch from `icon: Puzzle` to `image: cookieYetiIcon`
- Redeploy `send-activation-code` edge function after email template update

