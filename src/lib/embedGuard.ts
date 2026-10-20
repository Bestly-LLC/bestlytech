// Imported FIRST by main.tsx so it runs before the app is even loaded: a framed admin that is not
// framed by Cloud throws here and nothing else boots. See cloudEmbed.ts.
import { guardFraming } from "./cloudEmbed";

guardFraming();
