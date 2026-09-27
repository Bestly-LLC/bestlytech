/**
 * Take-home badge: a Kings Road x West Hollywood keepsake drawn on a canvas (original art, no logos).
 * Sunset, retro striped sun, palms, a street sign, a rainbow crosswalk, the guest's signature, name, emoji and number.
 */

export type BadgeInput = {
  name: string;
  strokes: number[][]; // flat [x, y, ...] normalized 0..1000 (x and y share the width scale)
  color: string;
  emoji: string | null;
  badgeNo: number;
  when: Date;
};

export const BADGE_W = 1080;
export const BADGE_H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function palm(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, height: number, lean: number, flip: 1 | -1) {
  const topX = baseX + lean * flip, topY = baseY - height;
  ctx.save();
  ctx.fillStyle = "#1a0c2c";
  ctx.strokeStyle = "#1a0c2c";
  // trunk: tapered curve
  ctx.beginPath();
  ctx.moveTo(baseX - 16, baseY);
  ctx.quadraticCurveTo(baseX + lean * 0.2 * flip - 10, baseY - height * 0.55, topX - 6, topY);
  ctx.lineTo(topX + 6, topY);
  ctx.quadraticCurveTo(baseX + lean * 0.2 * flip + 10, baseY - height * 0.55, baseX + 16, baseY);
  ctx.closePath();
  ctx.fill();
  // trunk rings
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#3a1d57";
  ctx.lineWidth = 3;
  for (let t = 0.12; t < 0.95; t += 0.09) {
    const px = baseX + (topX - baseX) * t * t + lean * 0.2 * flip * (1 - t) * t * 2, py = baseY - height * t;
    ctx.beginPath();
    ctx.moveTo(px - 12 + t * 5, py);
    ctx.lineTo(px + 12 - t * 5, py - 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // fronds
  const fronds = [-160, -130, -100, -70, -40, -10, 20, 200, 170];
  for (const a of fronds) {
    const ang = (a * Math.PI) / 180, len = height * 0.42;
    const ex = topX + Math.cos(ang) * len, ey = topY + Math.sin(ang) * len * 0.55 + len * 0.28;
    const cx = topX + Math.cos(ang) * len * 0.55, cy = topY + Math.sin(ang) * len * 0.5 - len * 0.18;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(cx, cy - 12, ex, ey);
    ctx.quadraticCurveTo(cx, cy + 14, topX, topY + 4);
    ctx.fill();
  }
  // coconuts
  ctx.beginPath();
  ctx.arc(topX - 8, topY + 10, 8, 0, Math.PI * 2);
  ctx.arc(topX + 9, topY + 12, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function streetSign(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  // pole
  ctx.fillStyle = "#2a1640";
  rr(ctx, x + 150, y + 30, 14, Math.max(120, 770 - (y + 30)), 6);
  ctx.fill();
  ctx.fillStyle = "#3b2159";
  rr(ctx, x + 146, y + 20, 22, 18, 5);
  ctx.fill();
  const blade = (bx: number, by: number, w: number, rot: number, big: string, small: string, suffix: string) => {
    ctx.save();
    ctx.translate(bx + w / 2, by + 34);
    ctx.rotate(rot);
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#0E7A45";
    rr(ctx, -w / 2, -34, w, 68, 10);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#F4FFF8";
    ctx.lineWidth = 4;
    rr(ctx, -w / 2 + 7, -27, w - 14, 54, 7);
    ctx.stroke();
    ctx.fillStyle = "#F4FFF8";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `700 22px ${FONT}`;
    const smallW = ctx.measureText(small).width;
    ctx.font = `800 40px ${FONT}`;
    const bigW = ctx.measureText(big).width;
    ctx.font = `700 22px ${FONT}`;
    const sufW = ctx.measureText(suffix).width;
    const total = smallW + 10 + bigW + 8 + sufW;
    let cx = -total / 2;
    ctx.fillText(small, cx, 3);
    cx += smallW + 10;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(big, cx, 2);
    cx += bigW + 8;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(suffix, cx, -8);
    ctx.restore();
  };
  blade(x - 40, y - 26, 380, -0.02, "Kings", "N", "RD");
  blade(x + 18, y + 48, 290, 0.035, "WeHo", "", "CA");
  ctx.restore();
}

function drawSignature(ctx: CanvasRenderingContext2D, strokes: number[][], color: string, box: { x: number; y: number; w: number; h: number }) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const st of strokes) for (let i = 0; i + 1 < st.length; i += 2) {
    x0 = Math.min(x0, st[i]); x1 = Math.max(x1, st[i]); y0 = Math.min(y0, st[i + 1]); y1 = Math.max(y1, st[i + 1]);
  }
  if (x1 < x0) return;
  const w = Math.max(60, x1 - x0), h = Math.max(40, y1 - y0);
  const k = Math.min(box.w / w, box.h / h);
  const ox = box.x + (box.w - w * k) / 2 - x0 * k, oy = box.y + (box.h - h * k) / 2 - y0 * k;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.lineWidth = Math.max(5, Math.min(11, 8 * Math.sqrt(k)));
  for (const st of strokes) {
    if (st.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(ox + st[0] * k, oy + st[1] * k);
    if (st.length === 2) ctx.lineTo(ox + st[0] * k + 0.1, oy + st[1] * k);
    for (let i = 2; i < st.length - 2; i += 2) {
      ctx.quadraticCurveTo(ox + st[i] * k, oy + st[i + 1] * k, ox + ((st[i] + st[i + 2]) / 2) * k, oy + ((st[i + 1] + st[i + 3]) / 2) * k);
    }
    if (st.length > 2) ctx.lineTo(ox + st[st.length - 2] * k, oy + st[st.length - 1] * k);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawBadge(input: BadgeInput): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = BADGE_W;
  c.height = BADGE_H;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const W = BADGE_W, H = BADGE_H, HORIZON = 720;

  ctx.save();
  rr(ctx, 0, 0, W, H, 72);
  ctx.clip();

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, "#1B0D45");
  sky.addColorStop(0.38, "#5E1E8C");
  sky.addColorStop(0.72, "#FF4F8B");
  sky.addColorStop(1, "#FFB35C");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HORIZON);

  // a few stars up top
  ctx.fillStyle = "rgba(255,255,255,.7)";
  for (let i = 0; i < 26; i++) {
    const sx = (i * 397 + 83) % W, sy = 30 + ((i * 211) % 230), sr = 1.5 + (i % 3);
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
  }

  // retro striped sun sitting on the horizon
  const sunX = W / 2, sunY = HORIZON - 40, sunR = 250;
  const sun = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR * 0.3);
  sun.addColorStop(0, "#FFF1A8");
  sun.addColorStop(0.55, "#FFB054");
  sun.addColorStop(1, "#FF5E7A");
  ctx.save();
  ctx.shadowColor = "rgba(255,180,90,.8)";
  ctx.shadowBlur = 80;
  ctx.fillStyle = sun;
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR, Math.PI, 0); ctx.lineTo(sunX + sunR, HORIZON); ctx.lineTo(sunX - sunR, HORIZON); ctx.closePath(); ctx.fill();
  ctx.restore();
  // cut stripes through the lower half of the sun
  ctx.save();
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR + 1, Math.PI, 0); ctx.lineTo(sunX + sunR + 1, HORIZON); ctx.lineTo(sunX - sunR - 1, HORIZON); ctx.closePath();
  ctx.clip();
  ctx.fillStyle = sky;
  for (let i = 0; i < 6; i++) {
    const t = i / 5, yy = sunY - sunR * 0.55 + t * (sunR * 0.55 + 30), hh = 4 + i * 4;
    ctx.fillRect(sunX - sunR - 4, yy, sunR * 2 + 8, hh);
  }
  ctx.restore();

  // hills / skyline silhouette at the horizon
  ctx.fillStyle = "#2A0F3F";
  ctx.beginPath();
  ctx.moveTo(0, HORIZON);
  const hills = [[0, 650], [120, 628], [230, 660], [330, 640], [420, 668], [700, 664], [790, 632], [900, 655], [1000, 624], [1080, 646]];
  for (const [hx, hy] of hills) ctx.lineTo(hx, hy);
  ctx.lineTo(W, HORIZON);
  ctx.closePath();
  ctx.fill();

  // street
  const ground = ctx.createLinearGradient(0, HORIZON, 0, H);
  ground.addColorStop(0, "#1A0B2A");
  ground.addColorStop(1, "#0C0614");
  ctx.fillStyle = ground;
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  ctx.fillStyle = "#24133A";
  ctx.beginPath();
  ctx.moveTo(W / 2 - 60, HORIZON); ctx.lineTo(W / 2 + 60, HORIZON); ctx.lineTo(W + 260, H); ctx.lineTo(-260, H); ctx.closePath();
  ctx.fill();
  // rainbow crosswalk
  const bands = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#0A84FF", "#AF52DE"];
  const cwY = 770, cwH = 56;
  const left = (yy: number) => W / 2 - 60 - ((yy - HORIZON) / (H - HORIZON)) * (W / 2 + 200);
  const right = (yy: number) => W - left(yy);
  bands.forEach((col, i) => {
    const n = bands.length, bl = left(cwY), br = right(cwY), bl2 = left(cwY + cwH), br2 = right(cwY + cwH);
    const f0 = i / n, f1 = (i + 1) / n;
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.moveTo(bl + (br - bl) * f0 + 6, cwY);
    ctx.lineTo(bl + (br - bl) * f1 - 6, cwY);
    ctx.lineTo(bl2 + (br2 - bl2) * f1 - 8, cwY + cwH);
    ctx.lineTo(bl2 + (br2 - bl2) * f0 + 8, cwY + cwH);
    ctx.closePath();
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // palms
  palm(ctx, 90, HORIZON + 40, 470, 70, 1);
  palm(ctx, 1000, HORIZON + 50, 520, 80, -1);
  palm(ctx, 880, HORIZON + 10, 330, 40, -1);

  // street sign
  streetSign(ctx, 70, 392);

  // headline
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText("KINGS ROAD  ×  WEST HOLLYWOOD", 72, 110);
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(20,0,40,.45)";
  ctx.shadowBlur = 24;
  ctx.font = `800 96px ${ROUNDED}`;
  ctx.fillText("I signed", 68, 212);
  ctx.fillText("the wall.", 68, 306);
  ctx.shadowColor = "transparent";

  // emoji sticker
  if (input.emoji) {
    ctx.save();
    ctx.translate(850, 250);
    ctx.rotate(0.12);
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(255,79,139,.35)";
    ctx.lineWidth = 6;
    ctx.setLineDash([2, 14]);
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, 102, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `132px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillText(input.emoji, 0, 8);
    ctx.restore();
  }

  // signature card
  const cx = 60, cy = 860, cw = W - 120, ch = 430;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.08)";
  rr(ctx, cx, cy, cw, ch, 44);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.16)";
  ctx.lineWidth = 2;
  rr(ctx, cx + 1, cy + 1, cw - 2, ch - 2, 43);
  ctx.stroke();
  ctx.restore();
  drawSignature(ctx, input.strokes, input.color, { x: cx + 60, y: cy + 36, w: cw - 120, h: 210 });
  // baseline
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.fillRect(cx + 60, cy + 262, cw - 120, 2);

  const name = (input.name || "").trim() || "A friend of the wall";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  let fs = 58;
  ctx.font = `800 ${fs}px ${ROUNDED}`;
  while (ctx.measureText(name).width > cw - 120 && fs > 30) { fs -= 2; ctx.font = `800 ${fs}px ${ROUNDED}`; }
  ctx.fillText(name, cx + 60, cy + 336);

  const date = input.when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
  const time = input.when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
  ctx.fillStyle = "rgba(255,255,255,.62)";
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(`${date} · ${time}`, cx + 60, cy + 390);

  const no = `No. ${String(input.badgeNo).padStart(4, "0")}`;
  ctx.textAlign = "right";
  ctx.fillStyle = input.color;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(no, cx + cw - 60, cy + 390);

  ctx.restore();
  return c;
}

export function badgeBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
}
