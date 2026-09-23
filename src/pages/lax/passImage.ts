/**
 * "Save the QR code to your phone" → a PNG that looks like the Apple Wallet pass:
 * purple card, logo + "LAX - Turo Rental", the LAX sunset strip, the same fields, and the QR.
 * Drawn on a canvas in the browser (same-origin images, so the canvas stays exportable).
 */
export type PassImageInput = {
  qr: HTMLCanvasElement;          // the hidden QRCodeCanvas already on the page
  trip?: { first: string | null; starts_at: string; ends_at: string } | null;
  level: string;
  shuttle: string;                // e.g. "Parking Spot Century"
  thru: string;                   // e.g. "September 30"
  afterHours?: string;
  garage: string;
};

const LA = "America/Los_Angeles";
const BG = "#2B1A73";
const PAGE = "#1A1140";
const PEACH = "#FFB878";
const FONT = `-apple-system, "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif`;
const short = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: LA })}, ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: LA })}`;

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/** Shrink the font until the text fits the column, like Wallet does. */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 24);
}

export async function renderPassImage(p: PassImageInput): Promise<Blob> {
  const W = 1170, M = 45, CW = W - M * 2;           // 3x of a 390pt iPhone width
  const [logo, strip] = await Promise.all([load("/wallet/lax/logo@3x.png"), load("/wallet/lax/strip@3x.png")]);
  const stripH = Math.round((CW * strip.height) / strip.width);

  type Field = { label: string; value: string };
  const row1: Field[] = p.trip
    ? [{ label: p.trip.first ? `${p.trip.first.toUpperCase()}'S PICKUP` : "PICKUP", value: short(p.trip.starts_at) }, { label: "RETURN", value: short(p.trip.ends_at) }]
    : [{ label: "GARAGE", value: "Park My Share" }, { label: "LEVEL", value: `${p.level} only` }];
  const row2: Field[] = p.trip
    ? [{ label: "GARAGE", value: "Park My Share" }, { label: "LEVEL", value: p.level }, { label: "SHUTTLE", value: p.shuttle }]
    : [{ label: "SHUTTLE", value: p.shuttle }, { label: "GOOD THRU", value: p.thru }, ...(p.afterHours ? [{ label: "AFTER HOURS", value: p.afterHours }] : [])];

  const headerH = 170, fieldsTop = headerH + stripH + 50, row1H = 130, row2H = 120;
  const qrBox = 660, qrTop = fieldsTop + row1H + row2H + 70;
  const cardH = qrTop + qrBox + 90 + 70;
  const H = cardH + M * 2 + 90;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = PAGE; ctx.fillRect(0, 0, W, H);

  // Card
  ctx.save();
  roundRect(ctx, M, M, CW, cardH, 42);
  ctx.fillStyle = BG; ctx.fill();
  ctx.clip();

  // Header: logo + title
  const lh = 96, lw = (logo.width / logo.height) * lh;
  ctx.drawImage(logo, M + 48, M + (headerH - lh) / 2, lw, lh);
  ctx.fillStyle = "#fff";
  ctx.font = `600 54px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("LAX - Turo Rental", M + 48 + lw + 24, M + headerH / 2 + 2);

  // Strip art
  ctx.drawImage(strip, M, M + headerH, CW, stripH);

  // Fields
  ctx.textBaseline = "alphabetic";
  const drawRow = (fields: Field[], top: number, labelSize: number, valueSize: number) => {
    const colW = (CW - 96) / fields.length;
    fields.forEach((f, i) => {
      const x = M + 48 + i * colW;
      const alignRight = fields.length === 2 && i === 1;
      ctx.textAlign = alignRight ? "right" : "left";
      const tx = alignRight ? M + CW - 48 : x;
      ctx.fillStyle = PEACH; ctx.font = `600 ${labelSize}px ${FONT}`;
      ctx.fillText(f.label, tx, M + top);
      ctx.fillStyle = "#fff"; fitText(ctx, f.value, 500, valueSize, colW - 16);
      ctx.fillText(f.value, tx, M + top + valueSize + 14);
    });
    ctx.textAlign = "left";
  };
  drawRow(row1, fieldsTop, 34, 58);
  drawRow(row2, fieldsTop + row1H, 32, 50);

  // QR on a white tile, with the alt text under it (like the pass)
  const qx = M + (CW - qrBox) / 2, qy = M + qrTop;
  roundRect(ctx, qx, qy, qrBox, qrBox + 90, 24);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(p.qr, qx + 30, qy + 30, qrBox - 60, qrBox - 60);
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#111"; ctx.font = `500 40px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText("Scan at the lobby door", qx + qrBox / 2, qy + qrBox + 40);
  ctx.restore();

  // Footer under the card
  ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = `500 34px ${FONT}`;
  ctx.fillText(`Good through ${p.thru} · ${p.garage.split(",")[0]}`, W / 2, M + cardH + 64);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png"));
}
