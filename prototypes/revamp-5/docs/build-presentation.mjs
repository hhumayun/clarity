// Builds docs/design.html: DESIGN.md as one self-contained page, with live specimens of
// revamp 5's ("Sage") colour, type and motion. node docs/build-presentation.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path));
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ttf": "font/ttf" };
const dataUri = (path) => `data:${MIME[extname(path)]};base64,${read(path).toString("base64")}`;

// The tokens, as in src/theme/tokens.ts.
const light = { page: "#F2F0EB", card: "#FFFFFF", sunken: "#F4F2EE", ink: "#1F1D1A", ink2: "#57524B", ink3: "#6F6A62", hairline: "#EEEBE5", line: "#E1DDD5", warm: "#B4532A", shadow: "0 12px 32px rgba(48,40,28,.16), 0 2px 8px rgba(48,40,28,.08)" };
const dark = { page: "#121110", card: "#1E1C1A", sunken: "#292724", ink: "#F2EFE9", ink2: "#BCB6AC", ink3: "#959087", hairline: "#2B2926", line: "#3A3733", warm: "#F0956C", shadow: "0 12px 32px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35)" };
const accents = {
  sage: { label: "Sage", light: ["#47775B", "#FFFFFF", "#E3EDE6", "#2F5A41", "#1F3B2C"], dark: ["#8DC6A5", "#10160F", "#1F3328", "#B9E0C8", "#264A37"] },
  ink: { label: "Ink", light: ["#1F1D1A", "#FFFFFF", "#ECE9E3", "#1F1D1A", "#1F1D1A"], dark: ["#F2EFE9", "#121110", "#33302C", "#F2EFE9", "#3A3631"] },
  sky: { label: "Sky", light: ["#2E62A3", "#FFFFFF", "#E2EAF5", "#234C80", "#1B3150"], dark: ["#90B8EF", "#0E1520", "#1D2B3D", "#C3D8F6", "#223A5C"] },
  rose: { label: "Rose", light: ["#B0385A", "#FFFFFF", "#F6E2E7", "#8C2A47", "#47192A"], dark: ["#F29CB4", "#200D13", "#3A1F28", "#F8C9D6", "#572234"] },
  amber: { label: "Amber", light: ["#965811", "#FFFFFF", "#F5E9D8", "#76450D", "#45290B"], dark: ["#EAB56C", "#1E1405", "#3A2C17", "#F4D3A2", "#553612"] },
  plum: { label: "Plum", light: ["#77479F", "#FFFFFF", "#EDE4F5", "#5C3580", "#301C47"], dark: ["#CAA8EB", "#170F20", "#2D2238", "#E1CCF5", "#3E2A58"] },
};
const vars = (palette) => Object.entries(palette).map(([key, value]) => `--${key}:${value};`).join("");
const accentVars = (name, mode) => {
  const [solid, on, soft, onSoft, deep] = accents[name][mode];
  return `--accent:${solid};--on:${on};--soft:${soft};--onSoft:${onSoft};--deep:${deep};`;
};
const accentRules = Object.keys(accents)
  .map((name) => `html[data-accent="${name}"]{${accentVars(name, "light")}}html[data-accent="${name}"][data-mode="dark"]{${accentVars(name, "dark")}}`)
  .join("\n");

// A duration-based spring sampled into a CSS linear() easing (stiffness (2π / duration)²).
function spring(ms, ratio) {
  const w0 = (2 * Math.PI) / (ms / 1000);
  const wd = w0 * Math.sqrt(Math.max(0, 1 - ratio * ratio));
  const at = (t) => (ratio < 1 ? 1 - Math.exp(-ratio * w0 * t) * (Math.cos(wd * t) + ((ratio * w0) / wd) * Math.sin(wd * t)) : 1 - Math.exp(-w0 * t) * (1 + w0 * t));
  let end = 0;
  for (let t = 0; t < 2; t += 0.004) if (Math.abs(1 - at(t)) > 0.004) end = t;
  end = Math.min(2, end + 0.02);
  const n = 40;
  const points = Array.from({ length: n + 1 }, (_, i) => at((end * i) / n).toFixed(3));
  points[0] = "0";
  points[n] = "1";
  return { css: `linear(${points.join(", ")})`, ms: Math.round(end * 1000) };
}
const S = { pop: spring(420, 0.58), glide: spring(460, 0.78), lead: spring(320, 0.82), trail: spring(540, 0.86), bloom: spring(420, 0.7) };
const EASE = "cubic-bezier(.16,1,.3,1)";

const face = (weight, file) => `@font-face{font-family:"Nunito Sans";src:url(${dataUri(`node_modules/@expo-google-fonts/nunito-sans/${file}`)}) format("truetype");font-weight:${weight};font-display:block}`;
const fonts = [face(400, "400Regular/NunitoSans_400Regular.ttf"), face(600, "600SemiBold/NunitoSans_600SemiBold.ttf"), face(700, "700Bold/NunitoSans_700Bold.ttf"), face(800, "800ExtraBold/NunitoSans_800ExtraBold.ttf")].join("\n");

marked.use({
  renderer: {
    image({ href, text }) {
      return `<figure><img src="${dataUri(href)}" alt="${text}" loading="lazy"><figcaption>${text}</figcaption></figure>`;
    },
  },
});

const check = `<svg viewBox="0 0 28 28" width="28" height="28"><path class="hint" d="M8.2 14.4l3.6 3.6 7.6-8"/><path class="mark" d="M8.2 14.4l3.6 3.6 7.6-8"/></svg>`;

const specimens = {
  palette: `
<div class="spec">
  <div class="swatches">
    ${["page", "card", "sunken", "ink", "ink2", "ink3", "line", "warm"].map((k) => `<div class="sw"><span style="background:var(--${k})"></span><b>${k}</b><code>${light[k]} · ${dark[k]}</code></div>`).join("")}
  </div>
  <p class="cap">Your colour. Tap one: the page takes it, as the app does.</p>
  <div class="picker">${Object.entries(accents).map(([name, a]) => `<button class="tile" data-pick="${name}"><span class="disc" style="background:${a.light[0]}"></span>${a.label}</button>`).join("")}</div>
</div>`,
  type: `
<div class="spec ramp">
  <div><span class="t1">Slow morning</span><code>title1 · 26 bold</code></div>
  <div><span class="t2">Send the brief to Ana</span><code>title2 · 21 bold</code></div>
  <div><span class="hl">Today</span> <span class="hl dim">Monday 5 October</span><code>headline · 17 bold</code></div>
  <div><span class="pr">What would make today feel well spent?</span><code>prompt · 18 semibold, accent</code></div>
  <div><span class="bd">Coffee on the step before anyone else was up.</span><code>body · 17/27</code></div>
  <div><span class="sc">Tasks</span><code>section · 15 semibold, centred</code></div>
  <div><span class="eb">Monday 5 October · 7:40 am</span><code>eyebrow · 12 bold caps</code></div>
  <div><span class="nm">15</span><code>numerals · focus only</code></div>
</div>`,
  motion: `
<div class="spec motion">
  <div class="demo">
    <div class="card row"><div><b>Book the dentist</b><small>● Health</small></div><button class="check" aria-label="Tick">${check}<i class="halo"></i></button></div>
    <p class="cap">The check: fill from the middle, pop, halo, a line through the words. Tap it.</p>
  </div>
  <div class="demo">
    <button class="btn morph"><span class="w">Done</span><span class="c">✓</span></button>
    <p class="cap">A button answers in place: the words become a check. Tap it.</p>
  </div>
  <div class="demo">
    <div class="week"><i class="disc"></i>${["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d, i) => `<button data-day="${i}"><small>${d}</small><b>${5 + i}</b></button>`).join("")}</div>
    <p class="cap">The day's disc stretches toward the day you tap and gathers when it lands.</p>
  </div>
  <div class="demo dialdemo">
    <div class="dial"><span class="opt l">✎ Note</span><span class="opt r">◎ Task</span><button class="fab" aria-label="Open the dial">+</button></div>
    <p class="cap">The + dial: + turns into ×, Note and Task spring out. Tap it.</p>
  </div>
  <div class="demo">
    <div class="card thinking"><span class="dots"><i></i><i></i><i></i></span><p class="stream" data-text="The outline is done and the budget section is next. Check whether the quote includes VAT first."></p></div>
    <p class="cap">How it's going: three dots, then the words write themselves in. Tap the card.</p>
  </div>
</div>`,
};

let html = marked.parse(read("DESIGN.md").toString());
html = html.replace('<h2 id="colour">Colour</h2>', `<h2 id="colour">Colour</h2>${specimens.palette}`);
html = html.replace("<h2>Colour</h2>", `<h2>Colour</h2>${specimens.palette}`);
html = html.replace("<h2>Type</h2>", `<h2>Type</h2>${specimens.type}`);
html = html.replace("<h2>Motion</h2>", `<h2>Motion</h2>${specimens.motion}`);

const page = `<!doctype html>
<html lang="en-GB" data-accent="sage" data-mode="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clarity revamp 5: Sage</title>
<style>
${fonts}
:root{${vars(light)}${accentVars("sage", "light")}}
html[data-mode="dark"]{${vars(dark)}}
${accentRules}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:400 17px/1.6 "Nunito Sans",system-ui,sans-serif;transition:background .3s ${EASE},color .3s ${EASE}}
main{max-width:880px;margin:0 auto;padding:40px 24px 120px}
h1{font-weight:800;font-size:40px;line-height:1.1;letter-spacing:-.6px;margin:12px 0 18px}
h2{font-weight:800;font-size:26px;letter-spacing:-.3px;margin:56px 0 12px;padding-top:12px}
h3{font-weight:700;font-size:19px;margin:28px 0 8px}
p,li{color:var(--ink2)} strong{color:var(--ink)}
a{color:var(--accent)}
code{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--ink3);background:var(--sunken);padding:1px 6px;border-radius:6px}
table{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border-radius:18px;overflow:hidden;margin:16px 0;font-size:15px}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--hairline);vertical-align:top}
th{color:var(--ink3);font-weight:600;font-size:13px}
tr:last-child td{border-bottom:0}
figure{margin:20px 0}
figure img{width:100%;border-radius:22px;display:block}
figcaption{text-align:center;color:var(--ink3);font-size:14px;margin-top:8px}
.bar{position:sticky;top:0;z-index:5;display:flex;gap:10px;justify-content:flex-end;padding:10px 24px;background:color-mix(in srgb,var(--page) 88%,transparent);backdrop-filter:blur(12px)}
.bar button{font:600 14px "Nunito Sans";border:0;border-radius:999px;padding:8px 14px;background:var(--card);color:var(--ink);cursor:pointer}
.qr{display:flex;gap:20px;align-items:center;background:var(--card);border-radius:18px;padding:16px;margin:18px 0}
.qr img{width:132px;height:132px;border-radius:12px;background:#fff}
.spec{background:var(--card);border-radius:22px;padding:22px;margin:18px 0}
.cap{color:var(--ink3);font-size:14px;margin:10px 0 0}
.swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.sw{display:flex;flex-direction:column;gap:4px;font-size:13px}
.sw span{height:46px;border-radius:12px;border:1px solid var(--line)}
.sw b{font-weight:700;color:var(--ink)} .sw code{background:none;padding:0}
.picker{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:12px}
.tile{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 4px;border-radius:18px;border:1.5px solid transparent;background:var(--sunken);font:600 13px "Nunito Sans";color:var(--ink2);cursor:pointer}
.tile.on{border-color:var(--ink);color:var(--ink);background:var(--card)}
.tile .disc{width:36px;height:36px;border-radius:50%;transition:transform .42s ${S.pop.css}}
.tile.on .disc{transform:scale(1.08)}
.ramp div{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--hairline)}
.ramp div:last-child{border:0}
.t1{font:700 26px/32px "Nunito Sans";letter-spacing:-.4px}.t2{font:700 21px/27px "Nunito Sans"}.hl{font:700 17px "Nunito Sans"}.hl.dim{color:var(--ink3);font-weight:600}
.pr{font:600 18px/25px "Nunito Sans";color:var(--accent)}.bd{font:400 17px/27px "Nunito Sans"}.sc{font:600 15px "Nunito Sans";color:var(--ink3)}
.eb{font:700 12px "Nunito Sans";letter-spacing:.7px;text-transform:uppercase;color:var(--ink3)}.nm{font:800 64px/1 "Nunito Sans";letter-spacing:-2px}
.motion{display:grid;grid-template-columns:1fr 1fr;gap:18px;background:var(--page)}
.demo{background:var(--card);border-radius:18px;padding:16px}
.card.row{display:flex;align-items:center;justify-content:space-between}
.card.row small{display:block;color:var(--ink3);font-size:13px}
.card.row b{font-weight:400;font-size:17px;color:var(--ink);background:linear-gradient(var(--ink3),var(--ink3)) left 58%/0 1.5px no-repeat;transition:background-size .26s ${EASE},color .2s}
.card.row.done b{background-size:100% 1.5px;color:var(--ink3)}
.check{position:relative;width:44px;height:44px;border:0;background:none;cursor:pointer;display:grid;place-items:center}
.check svg{width:28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 1.75px var(--ink2);transition:transform .42s ${S.pop.css},background .22s}
.check .hint{fill:none;stroke:var(--ink3);stroke-opacity:.55;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.check .mark{fill:none;stroke:var(--on);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:17;stroke-dashoffset:17;transition:stroke-dashoffset .22s ${EASE}}
.done .check svg{background:var(--accent);box-shadow:none;animation:pop .51s}
.done .check .hint{opacity:0}.done .check .mark{stroke-dashoffset:0}
.halo{position:absolute;inset:8px;border-radius:50%;border:2px solid var(--accent);opacity:0;pointer-events:none}
.done .halo{animation:halo .56s ${EASE}}
@keyframes pop{0%{transform:scale(1)}18%{transform:scale(.82)}100%{transform:scale(1)}}
@keyframes halo{0%{opacity:.55;transform:scale(1)}100%{opacity:0;transform:scale(1.75)}}
.btn{position:relative;width:100%;height:50px;border:0;border-radius:14px;background:var(--accent);color:var(--on);font:700 17px "Nunito Sans";cursor:pointer;overflow:hidden}
.btn span{position:absolute;inset:0;display:grid;place-items:center;transition:transform .26s ${EASE},opacity .26s}
.btn .c{opacity:0;transform:scale(.6);font-size:22px}
.btn.on .w{opacity:0;transform:translateY(-14px)}.btn.on .c{opacity:1;transform:scale(1);transition:transform .42s ${S.pop.css},opacity .2s}
.week{position:relative;display:grid;grid-template-columns:repeat(7,1fr)}
.week button{position:relative;z-index:1;border:0;background:none;display:flex;flex-direction:column;align-items:center;gap:6px;font:600 16px "Nunito Sans";color:var(--ink2);cursor:pointer;padding:0}
.week small{font:700 12px "Nunito Sans";color:var(--ink3)}
.week button.on{color:var(--ink)}
.week .disc{position:absolute;top:22px;height:36px;border-radius:18px;background:var(--sunken);left:0;width:36px}
.dialdemo{position:relative}
.dial{position:relative;height:150px;display:flex;align-items:flex-end;justify-content:center}
.fab{position:relative;z-index:2;width:56px;height:56px;border-radius:50%;border:0;background:var(--accent);color:var(--on);font:400 32px/1 "Nunito Sans";cursor:pointer;transition:transform .42s ${S.bloom.css};box-shadow:var(--shadow)}
.dial.on .fab{transform:rotate(135deg)}
.opt{position:absolute;bottom:10px;left:50%;padding:12px 18px;border-radius:999px;background:var(--card);box-shadow:var(--shadow);font:700 15px "Nunito Sans";white-space:nowrap;opacity:0;transform:translate(-50%,0) scale(.5);transition:transform .42s ${S.bloom.css},opacity .2s}
.dial.on .opt.l{opacity:1;transform:translate(calc(-50% - 70px),-80px) scale(1)}
.dial.on .opt.r{opacity:1;transform:translate(calc(-50% + 70px),-80px) scale(1)}
.thinking{min-height:96px;cursor:pointer}
.dots{display:flex;gap:6px;height:18px;align-items:center}
.dots i{width:7px;height:7px;border-radius:50%;background:var(--ink3);animation:dot 1.08s infinite ease-in-out}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes dot{0%,66%,100%{transform:translateY(0);opacity:.45}33%{transform:translateY(-5px);opacity:1}}
.stream{margin:0;color:var(--ink);font-size:16px}
@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
@media (max-width:640px){.motion{grid-template-columns:1fr}.swatches{grid-template-columns:repeat(2,1fr)}.picker{grid-template-columns:repeat(3,1fr)}}
</style>
</head>
<body>
<div class="bar"><button id="mode">Dark</button></div>
<main>
<div class="qr"><img src="${dataUri("docs/expo-go-qr.png")}" alt="Expo Go QR code"><div><strong>Open it in Expo Go.</strong><br>Scan the code, or enter the address in DESIGN.md. The address changes whenever the tunnel restarts.</div></div>
${html}
</main>
<script>
const doc = document.documentElement;
document.getElementById("mode").onclick = (e) => { const d = doc.dataset.mode === "dark" ? "light" : "dark"; doc.dataset.mode = d; e.target.textContent = d === "dark" ? "Light" : "Dark"; };
document.querySelectorAll("[data-pick]").forEach((b) => { if (b.dataset.pick === "sage") b.classList.add("on"); b.onclick = () => { document.querySelectorAll("[data-pick]").forEach((x) => x.classList.toggle("on", x === b)); doc.dataset.accent = b.dataset.pick; }; });
document.querySelectorAll(".card.row .check").forEach((b) => b.onclick = () => { const row = b.closest(".row"); row.classList.remove("done"); void row.offsetWidth; row.classList.toggle("done"); });
document.querySelectorAll(".morph").forEach((b) => b.onclick = () => { b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 1400); });
document.querySelectorAll(".dial .fab").forEach((b) => b.onclick = () => b.parentElement.classList.toggle("on"));
const week = document.querySelector(".week"); const disc = week.querySelector(".disc"); let at = 0;
const place = (i, animate) => { const btn = week.querySelectorAll("button")[i]; const c = btn.offsetLeft + btn.offsetWidth / 2 - 18; const was = disc.offsetLeft;
  week.querySelectorAll("button").forEach((x, n) => x.classList.toggle("on", n === i));
  if (!animate) { disc.style.left = c + "px"; return; }
  const right = c > was; const lead = "${S.lead.css}", trail = "${S.trail.css}";
  disc.animate([{ left: was + "px", width: "36px" }, { left: (right ? was : c) + "px", width: Math.abs(c - was) + 36 + "px", offset: .45 }, { left: c + "px", width: "36px" }], { duration: ${S.trail.ms}, easing: "${EASE}" }).onfinish = () => (disc.style.left = c + "px"); };
requestAnimationFrame(() => place(0, false));
week.querySelectorAll("button").forEach((b, i) => b.onclick = () => { if (i !== at) { place(i, true); at = i; } });
document.querySelectorAll(".thinking").forEach((card) => card.onclick = () => { const dots = card.querySelector(".dots"), p = card.querySelector(".stream"); const words = p.dataset.text.split(" "); p.textContent = ""; dots.style.display = "flex";
  setTimeout(() => { dots.style.display = "none"; let n = 0; const t = setInterval(() => { p.textContent = words.slice(0, ++n).join(" "); if (n >= words.length) clearInterval(t); }, 56); }, 1300); });
</script>
</body>
</html>`;

writeFileSync(join(root, "docs/design.html"), page);
console.log("wrote docs/design.html", (page.length / 1024 / 1024).toFixed(1), "MB");
