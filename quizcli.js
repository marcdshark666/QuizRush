#!/usr/bin/env node
/**
 * quizcli — verktygsbältet för Quiz Rush: Jungle Escape.
 *
 * Hela spelet är EN fil (`index.html`, ~420 kB). Det gör det snabbt att ladda
 * och omöjligt att överblicka för hand: en trasig rad syns först när någon
 * startar spelet i en värld man inte råkade testa. Det här CLI:t är motvikten —
 * det läser filen som kod, startar spelet på riktigt i headless Chrome och
 * svarar med siffror i stället för gissningar.
 *
 *   node quizcli.js audit                 statisk hälsokoll (syntax, id:n, CDN, a11y, PWA)
 *   node quizcli.js models                GLB-filerna: finns de, är de hela, är de krediterade
 *   node quizcli.js smoke [--all]         starta spelet i headless Chrome, en värld i taget
 *   node quizcli.js prov                  funktionsprov: tangentbord, repetition, paus, a11y
 *   node quizcli.js perf [--world jungle] scenens tyngd och starttid
 *   node quizcli.js ai [--fil x.txt]      provkör AI-frågorna mot api/generate.js
 *   node quizcli.js size                  viktbudget: vad tittaren måste ladda ner
 *   node quizcli.js serve [--port 5217]   lokal server (tar nästa lediga port; --minuter 0 = evig)
 *   node quizcli.js report [--worklist]   allt ovan → RAPPORT.md (+ steg på The Work List)
 *   node quizcli.js las [--slapp|--puls]  projektlåset mellan noderna (delegerar till worklist.js)
 *   node quizcli.js deploy --ja           vercel --prod (aldrig utan --ja; backoff 6 h efter nekat tak)
 *
 * Inga beroenden: bara Node och Chrome. Allt som kan kosta pengar (deploy) kräver
 * en uttrycklig flagga.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const os = require('os');

const DIR = __dirname;
const INDEX = path.join(DIR, 'index.html');
const API = path.join(DIR, 'api', 'generate.js');
const MODELS = path.join(DIR, 'models');
const WORLDS = ['jungle', 'underwater', 'city', 'snakepit', 'arctic', 'ocean', 'dragon'];
const PORT = Number(flag('--port')) || 5217;

// ------------------------------------------------------------------ argument
function flag(namn, argv = process.argv) { const i = argv.indexOf(namn); return i === -1 ? null : (argv[i + 1] ?? ''); }
function harFlagga(namn, argv = process.argv) { return argv.includes(namn); }

// ------------------------------------------------------------------ utskrift
const FARG = process.stdout.isTTY && !harFlagga('--ingen-farg');
const f = (kod, s) => (FARG ? `\u001b[${kod}m${s}\u001b[0m` : s);
const gron = (s) => f('32', s); const gul = (s) => f('33', s);
const rod = (s) => f('31', s); const dov = (s) => f('90', s); const fet = (s) => f('1', s);

/** Varje kontroll landar här. `niva` styr exitkoden: fel = 1, varning = 0. */
class Protokoll {
  constructor(rubrik) { this.rubrik = rubrik; this.rader = []; }
  ok(namn, detalj) { this.rader.push({ niva: 'ok', namn, detalj }); return this; }
  varning(namn, detalj) { this.rader.push({ niva: 'varning', namn, detalj }); return this; }
  fel(namn, detalj) { this.rader.push({ niva: 'fel', namn, detalj }); return this; }
  get fel_() { return this.rader.filter((r) => r.niva === 'fel').length; }
  get varningar() { return this.rader.filter((r) => r.niva === 'varning').length; }
  skriv() {
    console.log(`\n${fet(this.rubrik)}`);
    for (const r of this.rader) {
      const m = r.niva === 'ok' ? gron('  ✓') : r.niva === 'varning' ? gul('  !') : rod('  ✗');
      console.log(`${m} ${r.namn}${r.detalj ? dov(`  ${r.detalj}`) : ''}`);
    }
    const s = `${this.rader.length} kontroller · ${this.fel_} fel · ${this.varningar} varningar`;
    console.log(dov(`  ${'─'.repeat(Math.min(60, s.length + 2))}\n  ${s}`));
    return this;
  }
  get json() { return { rubrik: this.rubrik, fel: this.fel_, varningar: this.varningar, rader: this.rader }; }
}

// ------------------------------------------------------------------ hjälp
function las(fil) { return fs.readFileSync(fil, 'utf8'); }
function finns(fil) { try { return fs.existsSync(fil); } catch { return false; } }
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

/** Inline-skripten ur en HTML-fil (bara de utan src — de andra är CDN). */
function inlineSkript(html) {
  const ut = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    // type= får bara läsas ur ÖPPNINGSTAGGEN. Läses det ur hela träffen räcker
    // ett <button type="button"> inne i koden för att blocket ska hoppas över —
    // och då granskas 368 kB JavaScript aldrig.
    const typ = (m[1].match(/type\s*=\s*"([^"]+)"/i) || [])[1] || '';
    if (typ && !/javascript|module/i.test(typ)) continue;   // JSON-block är inte kod
    ut.push({ kod: m[2], rad: html.slice(0, m.index).split('\n').length });
  }
  return ut;
}

/** node --check på en kodsträng, utan att smutsa ner projektet. */
function syntaxkoll(kod, etikett) {
  const tmp = path.join(os.tmpdir(), `quizcli-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmp, kod, 'utf8');
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    if (r.status === 0) return null;
    const rad = (r.stderr || '').split('\n').find((l) => l.includes('SyntaxError')) || (r.stderr || '').trim().split('\n')[0];
    return `${etikett}: ${rad}`;
  } finally { try { fs.unlinkSync(tmp); } catch { /* redan borta */ } }
}

// ------------------------------------------------------------------ audit
function audit() {
  const p = new Protokoll('Statisk hälsokoll — index.html, api och sidhuvudet');
  if (!finns(INDEX)) { p.fel('index.html saknas', DIR); return p; }
  const html = las(INDEX);
  // Kontrollerna nedan letar i koden, inte i kommentarerna: en kommentar som
  // FÖRKLARAR att user-scalable=no är borttaget ska inte flagga som fel.
  const kod = html.replace(/<!--[\s\S]*?-->/g, '');
  const bytes = Buffer.byteLength(html);
  p.ok('index.html läst', `${kb(bytes)}, ${html.split('\n').length} rader`);

  // 1. Kör koden ens? Ett syntaxfel i en 420 kB-fil är annars en vit skärm.
  const skript = inlineSkript(html);
  let syntaxfel = 0;
  for (const s of skript) {
    const fel = syntaxkoll(s.kod, `inline-skript vid rad ${s.rad}`);
    if (fel) { p.fel('JavaScript-syntax', fel); syntaxfel++; }
  }
  if (!syntaxfel) p.ok('JavaScript-syntax', `${skript.length} inline-block, alla parsar`);

  // 2. Dubbla id:n — getElementById tar det första och resten dör tyst.
  const idn = [...html.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const dubbletter = idn.filter((x, i) => idn.indexOf(x) !== i);
  if (dubbletter.length) p.fel('Dubbla id:n i HTML', [...new Set(dubbletter)].join(', '));
  else p.ok('Unika id:n', `${idn.length} element`);

  // 3. CDN-länkar måste vara versionslåsta: "latest" byter kod under fötterna.
  // preconnect/dns-prefetch pekar på ett värdnamn, inte på en fil — de kan inte
  // ha en version och ska inte räknas. three.js versioner heter r128, inte 1.2.8.
  const cdn = [...html.matchAll(/<(?:script|link)([^>]*?)(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/g)]
    .filter((m) => !/rel\s*=\s*"(preconnect|dns-prefetch)"/i.test(m[1]))
    .map((m) => m[2]);
  const olasta = cdn.filter((u) => !/fonts\.(googleapis|gstatic)/.test(u) && !/\/(?:\d+\.\d+[\w.]*|r\d+)\//.test(u));
  if (olasta.length) p.varning('CDN utan version', olasta.join(' '));
  else p.ok('CDN versionslåsta', `${cdn.length} externa resurser`);

  // 4. Nycklar får aldrig ligga i klienten.
  const nyckel = html.match(/\b(AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})/);
  if (nyckel) p.fel('API-nyckel i klientkoden', nyckel[1].slice(0, 12) + '…');
  else p.ok('Inga nycklar i klienten', 'AI:n går via api/generate.js');

  // 5. Tillgänglighet: det som faktiskt stänger ute folk.
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(kod)) p.varning('Zoom avstängd i viewport', 'user-scalable=no stänger ute den som behöver förstora texten');
  else p.ok('Zoom tillåten', 'viewport låser inte skalan');
  const a11y = [
    ['prefers-reduced-motion', /prefers-reduced-motion/, 'ingen hänsyn till «minska rörelse»'],
    ['aria-live på frågan', /aria-live/, 'skärmläsaren får aldrig veta att frågan bytts'],
    ['tangentbord', /addEventListener\(\s*['"]keydown/, 'spelet går inte att spela utan mus/touch'],
  ];
  for (const [namn, re, varfor] of a11y) (re.test(kod) ? p.ok(namn) : p.varning(namn, varfor));

  // 6. Robusthet.
  const robust = [
    ['global felhanterare', /window\.(addEventListener\(\s*['"]error|onerror)/, 'ett fel ger vit skärm utan förklaring'],
    ['pausar i bakgrunden', /visibilitychange/, 'spelet fortsätter rendera i en dold flik'],
    ['servicearbetare', /serviceWorker/, 'spelet fungerar inte offline'],
    ['manifest', /rel\s*=\s*"manifest"/, 'går inte att installera på mobilen'],
  ];
  for (const [namn, re, varfor] of robust) (re.test(kod) ? p.ok(namn) : p.varning(namn, varfor));

  // 7. Prestanda: obegränsad pixelRatio dödar en telefon med 3× skärm.
  if (/setPixelRatio\s*\(\s*Math\.min/.test(kod)) p.ok('pixelRatio taklagd');
  else p.varning('pixelRatio utan tak', 'en 3×-skärm renderar nio gånger så många pixlar');

  // 8. Skräp som inte hör hemma i en publicerad fil.
  const todo = (kod.match(/\b(TODO|FIXME|XXX|HACK)\b/g) || []).length;
  if (todo) p.varning('TODO/FIXME kvar', `${todo} stycken`);
  else p.ok('Inga TODO/FIXME');

  // 9. API-funktionen.
  if (!finns(API)) p.varning('api/generate.js saknas', 'AI-frågorna faller tillbaka på meningsklipparen');
  else {
    const api = las(API);
    const fel = syntaxkoll(api, 'api/generate.js');
    if (fel) p.fel('api/generate.js syntax', fel); else p.ok('api/generate.js parsar', kb(Buffer.byteLength(api)));
    if (/process\.env\.GEMINI_API_KEY/.test(api)) p.ok('Nyckeln läses ur miljön');
    else p.fel('Nyckeln läses inte ur miljön', 'GEMINI_API_KEY förväntas i process.env');
    const kedja = (api.match(/gemini-[\w.-]+/g) || []);
    if (kedja.length >= 2) p.ok('Modellkedja', [...new Set(kedja)].join(' → '));
    else p.varning('Ingen modellkedja', 'ett 503 från Gemini blir ett fel i stället för nästa modell');
  }

  // 10. .vercelignore — package.json/server.js får INTE deployas (funktionen är noll-beroende).
  const vi = path.join(DIR, '.vercelignore');
  if (finns(vi)) {
    const t = las(vi);
    const saknas = ['package.json', 'server.js'].filter((x) => !t.includes(x));
    if (saknas.length) p.varning('.vercelignore släpper igenom', saknas.join(', '));
    else p.ok('.vercelignore skyddar funktionen', 'package.json och server.js deployas inte');
  } else p.varning('.vercelignore saknas');

  // 11. Världarna måste hänga ihop med fienderna.
  const varldar = [...html.matchAll(/^\s{2}(\w+):\{name:'([^']+)'[\s\S]*?enemy:'(\w+)'/gm)].map((m) => ({ id: m[1], namn: m[2], fiende: m[3] }));
  if (varldar.length) p.ok('Världar', varldar.map((v) => `${v.id}→${v.fiende}`).join(' '));
  else p.varning('Kunde inte läsa WORLDS', 'strukturen har ändrats — kontrollen är blind');

  return p;
}

// ------------------------------------------------------------------ models
function modeller() {
  const p = new Protokoll('3D-modellerna');
  if (!finns(MODELS)) { p.fel('models/ saknas'); return p; }
  const filer = fs.readdirSync(MODELS).filter((x) => x.toLowerCase().endsWith('.glb'));
  if (!filer.length) { p.fel('Inga .glb-filer'); return p; }
  const html = finns(INDEX) ? las(INDEX) : '';
  const krediter = finns(path.join(MODELS, 'CREDITS.md')) ? las(path.join(MODELS, 'CREDITS.md')) : '';
  let summa = 0;
  for (const namn of filer) {
    const fil = path.join(MODELS, namn);
    const st = fs.statSync(fil);
    summa += st.size;
    // glTF-binär: magiskt tal "glTF" + version + total längd i huvudet.
    const fd = fs.openSync(fil, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0); fs.closeSync(fd);
    const magi = buf.toString('ascii', 0, 4);
    const langd = buf.readUInt32LE(8);
    if (magi !== 'glTF') p.fel(namn, 'inte en glTF-binär');
    else if (langd !== st.size) p.fel(namn, `huvudet säger ${langd} byte, filen är ${st.size} — trunkerad`);
    else {
      const anvand = html.includes(namn) || html.includes(namn.replace(/\.glb$/i, ''));
      const krediterad = krediter.includes(namn.replace(/\.glb$/i, ''));
      const noter = [kb(st.size), anvand ? null : 'används inte', krediterad ? null : 'saknar kredit'].filter(Boolean);
      (anvand && krediterad ? p.ok : p.varning).call(p, namn, noter.join(' · '));
    }
  }
  p.ok('Summa', `${filer.length} modeller, ${kb(summa)}`);
  return p;
}

// ------------------------------------------------------------------ server
/** Liten statisk server. Spelet laddar GLB med fetch — file:// är blockerat. */
function serva(port = PORT, forsok = 20) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const fil = path.join(DIR, rel === '/' ? 'index.html' : rel.replace(/^\/+/, ''));
    // Ingen väg ut ur projektmappen.
    if (!fil.startsWith(DIR)) { res.writeHead(403).end('nej'); return; }
    fs.readFile(fil, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(fil).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  // En kvarlämnad server (eller vad som helst annat) på porten ska inte fälla
  // en körning innan Chrome ens startat: vid EADDRINUSE flyttar vi oss uppåt
  // till nästa lediga port. Anroparen läser den riktiga porten med bas().
  const onskad = port;
  return new Promise((klar, fel) => {
    let kvar = forsok;
    let startad = false;
    server.on('error', (e) => {
      if (startad) { console.error(rod(`server: ${e.message}`)); return; }
      if (e && e.code === 'EADDRINUSE' && kvar-- > 0) { server.listen(++port, '127.0.0.1'); return; }
      fel(e);
    });
    server.listen(port, '127.0.0.1', () => {
      startad = true;
      if (port !== onskad) console.log(dov(`  Port ${onskad} är upptagen — servern tog ${port}`));
      klar(server);
    });
  });
}

/** Adressen servern faktiskt lyssnar på (porten kan ha flyttat sig). */
function bas(server) { return `http://127.0.0.1:${server.address().port}`; }

/** Stäng servern OCH klipp kvarlevande keep-alive-kopplingar — annars kan
 *  processen hänga kvar och hålla porten långt efter att körningen är klar. */
function stoppa(server) { try { server.closeAllConnections?.(); } catch {} try { server.close(); } catch {} }

// ------------------------------------------------------------------ chrome
function chromeVag() {
  const kandidater = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  return kandidater.find((x) => finns(x)) || null;
}

/** Kör en adress i headless Chrome och lämna tillbaka sidans DOM.
 *  WebGL i headless kräver SwiftShader — utan flaggorna startar spelet aldrig.
 *
 *  Måste vara asynkron: sidan hämtas från den lilla servern i SAMMA process.
 *  Med spawnSync står nodes händelseloop still, servern svarar aldrig, och
 *  Chrome väntar på ett svar som inte kan komma — provet dog på ETIMEDOUT
 *  trots att exakt samma kommando fungerade från skalet. */
function dumpDom(url, { budget = 15000 } = {}) {
  const chrome = chromeVag();
  if (!chrome) return Promise.reject(new Error('Hittar ingen Chrome. Sätt CHROME_PATH.'));
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'quizcli-'));
  const args = [
    '--headless=new', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profil}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=900,1400',
    `--virtual-time-budget=${budget}`, '--dump-dom', url,
  ];
  return new Promise((klar, fel) => {
    const barn = spawn(chrome, args, { windowsHide: true });
    let ut = '', klart = false;
    const stadaUpp = () => { try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* OS städar */ } };
    const dodsur = setTimeout(() => { klart = true; try { barn.kill(); } catch { /* redan död */ } stadaUpp(); fel(new Error(`Chrome svarade inte inom ${Math.round((budget + 45000) / 1000)} s`)); }, budget + 45000);
    barn.stdout.on('data', (d) => { ut += d; });
    barn.on('error', (e) => { if (klart) return; klart = true; clearTimeout(dodsur); stadaUpp(); fel(e); });
    barn.on('close', () => { if (klart) return; klart = true; clearTimeout(dodsur); stadaUpp(); klar(ut); });
  });
}

/** Spelets egen självtest-rapport (#qr-selftest) ur en DOM-dump. */
function lasSjalvtest(dom) {
  const m = dom.match(/<pre id="qr-selftest"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) return null;
  const rå = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  try { return JSON.parse(rå); } catch { return null; }
}

// ------------------------------------------------------------------ smoke
async function smoke() {
  const p = new Protokoll('Rökprov — spelet startat på riktigt i headless Chrome');
  const valda = harFlagga('--all') ? WORLDS : [flag('--world') || 'jungle'];
  let server;
  try { server = await serva(PORT); } catch (e) { p.fel('Kunde inte starta lokal server', e.message); return p; }
  try {
    for (const varld of valda) {
      // Utan GPU renderar SwiftShader varje bildruta i mjukvara. Fönstret hålls
      // kort och sidan lägger ner sig själv när provet är skrivet — annars blir
      // Chrome aldrig klar och --dump-dom lämnar ingenting ifrån sig.
      const url = `${bas(server)}/index.html?demo=${varld}&dist=600&selftest=1&fpsms=1600`;
      let dom = '';
      try { dom = await dumpDom(url, { budget: 9000 }); }
      catch (e) { p.fel(varld, `Chrome: ${e.message}`); continue; }
      const t = lasSjalvtest(dom);
      if (!t) { p.fel(varld, 'ingen självtestrapport — sidan nådde aldrig dit'); continue; }
      // Chrome kör headless med virtuell tid: fps-talet säger hur många rutor
      // som hann ritas per VIRTUELL sekund, inte hur spelet känns på en telefon.
      // Det som betyder något här är att det startade, utan fel, med rätt scen.
      const noter = [`start ${t.bootMs} ms`, t.renderer ? t.renderer.slice(0, 28) : null,
        t.scen != null ? `${t.scen} objekt` : null, t.drawCalls != null ? `${t.drawCalls} draw calls` : null].filter(Boolean).join(' · ');
      if ((t.fel || []).length) p.fel(varld, `${(t.fel || []).length} fel: ${t.fel.slice(0, 2).join(' | ')}`);
      else if (!t.webgl) p.fel(varld, 'ingen WebGL-kontext');
      else p.ok(varld, noter);
    }
  } finally { stoppa(server); }
  return p;
}

// ------------------------------------------------------------------ prov
/** Funktionsprov: gör de NYA sakerna vad de ska? Rökprovet svarar bara på om
 *  spelet startar. `qr-prov.html` kör spelet i en iframe och trycker på
 *  tangenter, gömmer fliken och läser localStorage — allt från samma origin. */
async function prov() {
  const p = new Protokoll('Funktionsprov — tangentbord, repetition, paus, tillgänglighet');
  if (!finns(path.join(DIR, 'qr-prov.html'))) { p.fel('qr-prov.html saknas'); return p; }
  let server;
  try { server = await serva(PORT); } catch (e) { p.fel('Kunde inte starta lokal server', e.message); return p; }
  try {
    // Provet väntar på spelets nedräkning och på att frågan byts — det tar
    // tiotals virtuella sekunder, så budgeten är större än rökprovets.
    const dom = await dumpDom(`${bas(server)}/qr-prov.html`, { budget: 60000 });
    const m = dom.match(/<pre id="prov"[^>]*>([\s\S]*?)<\/pre>/);
    if (!m) { p.fel('Ingen provrapport', 'sidan hann aldrig skriva sitt svar'); return p; }
    let rapport;
    try { rapport = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')); }
    catch (e) { p.fel('Provrapporten gick inte att läsa', e.message); return p; }
    for (const r of rapport.rader || []) (r.ok ? p.ok : p.fel).call(p, r.namn, r.detalj);
  } finally { stoppa(server); }
  return p;
}

// ------------------------------------------------------------------ perf
async function perf() {
  const p = new Protokoll('Prestanda');
  const varld = flag('--world') || 'jungle';
  let server;
  try { server = await serva(PORT); } catch (e) { p.fel('Server', e.message); return p; }
  try {
    const dom = await dumpDom(`${bas(server)}/index.html?demo=${varld}&dist=900&selftest=1&fpsms=4000`, { budget: 14000 });
    const t = lasSjalvtest(dom);
    if (!t) { p.fel('Ingen rapport', 'självtestet svarade inte'); return p; }
    p.ok('Värld', varld);
    p.ok('Starttid till spelbart', `${t.bootMs} ms`);
    // Virtuell tid gör fps-talet obrukbart som mått på upplevd mjukhet — det
    // redovisas, men det som granskas är scenens tyngd (draw calls, trianglar).
    p.ok('Rutor per virtuell sekund', `${t.fps} (headless, SwiftShader — inte upplevd fps)`);
    if (t.minne) p.ok('JS-heap', `${t.minne} MB`);
    if (t.renderer) p.ok('Renderare', t.renderer);
    if (t.drawCalls != null) (t.drawCalls <= 180 ? p.ok : p.varning).call(p, 'Draw calls', String(t.drawCalls));
    if (t.trianglar != null) p.ok('Trianglar', t.trianglar.toLocaleString('sv-SE'));
  } finally { stoppa(server); }
  return p;
}

// ------------------------------------------------------------------ size
function storlek() {
  const p = new Protokoll('Viktbudget — vad tittaren laddar ner');
  const zlib = require('zlib');
  const poster = [];
  const lagg = (namn, fil) => { if (!finns(fil)) return; const b = fs.readFileSync(fil); poster.push({ namn, rå: b.length, gzip: zlib.gzipSync(b).length }); };
  lagg('index.html', INDEX);
  lagg('js-gltfloader.js', path.join(DIR, 'js-gltfloader.js'));
  if (finns(MODELS)) for (const m of fs.readdirSync(MODELS).filter((x) => x.endsWith('.glb'))) lagg(`models/${m}`, path.join(MODELS, m));
  const forst = poster.filter((x) => !x.namn.startsWith('models/'));
  const summaForst = forst.reduce((a, x) => a + x.gzip, 0);
  for (const x of forst) p.ok(x.namn, `${kb(x.rå)} → ${kb(x.gzip)} gzip`);
  (summaForst < 400 * 1024 ? p.ok : p.varning).call(p, 'Första laddningen', `${kb(summaForst)} gzip (modellerna hämtas per värld)`);
  const modeller_ = poster.filter((x) => x.namn.startsWith('models/'));
  p.ok('Modeller vid behov', `${modeller_.length} st, ${kb(modeller_.reduce((a, x) => a + x.rå, 0))} totalt`);
  const tung = modeller_.filter((x) => x.rå > 800 * 1024);
  if (tung.length) p.varning('Tunga modeller', tung.map((x) => `${x.namn} ${kb(x.rå)}`).join(', '));
  return p;
}

// ------------------------------------------------------------------ ai
async function ai() {
  const p = new Protokoll('AI-frågorna (Gemini, gratisnivå — inga kostnader)');
  if (!finns(API)) { p.fel('api/generate.js saknas'); return p; }
  // Nyckeln kommer ur .env.local precis som Vercel sätter den i produktion.
  const envFil = path.join(DIR, '.env.local');
  if (finns(envFil)) {
    for (const rad of las(envFil).split('\n')) {
      const m = rad.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!process.env.GEMINI_API_KEY) { p.varning('GEMINI_API_KEY saknas', 'klienten faller tillbaka på meningsklipparen — provet hoppas över'); return p; }

  const filArg = flag('--fil');
  const text = filArg && finns(filArg) ? las(filArg) : PROVTEXT;
  const handler = require(API);
  const svar = await new Promise((klar) => {
    const res = {
      _status: 200, _json: null,
      status(k) { this._status = k; return this; },
      json(o) { this._json = o; klar({ status: this._status, body: o }); return this; },
      setHeader() { return this; }, end() { klar({ status: this._status, body: this._json }); },
    };
    const t0 = Date.now();
    Promise.resolve(handler({ method: 'POST', body: { text, count: 6, difficulty: flag('--niva') || 'medium' }, headers: {} }, res))
      .catch((e) => klar({ status: 500, body: { error: e.message } }))
      .then(() => { res._ms = Date.now() - t0; });
  });

  if (svar.status !== 200) { p.fel('Anropet', `HTTP ${svar.status}: ${JSON.stringify(svar.body).slice(0, 200)}`); return p; }
  const fragor = (svar.body && (svar.body.questions || svar.body.mcqs)) || [];
  if (!fragor.length) { p.fel('Inga frågor', JSON.stringify(svar.body).slice(0, 200)); return p; }
  p.ok('Frågor tillbaka', `${fragor.length} st${svar.body.model ? ` från ${svar.body.model}` : ''}`);
  // Kvaliteten: en fråga utan facit eller med bara ett alternativ är värdelös.
  let trasiga = 0;
  for (const q of fragor) {
    const alt = q.options || q.choices || [];
    const facit = q.answer ?? q.correct ?? q.correctIndex;
    if (alt.length < 3 || facit == null) trasiga++;
  }
  (trasiga ? p.fel : p.ok).call(p, 'Frågornas form', trasiga ? `${trasiga} utan facit eller med för få alternativ` : 'alla har facit och ≥3 alternativ');
  const unika = new Set(fragor.map((q) => String(q.question || q.q || '').trim().toLowerCase()));
  (unika.size === fragor.length ? p.ok : p.varning).call(p, 'Dubbletter', unika.size === fragor.length ? 'inga' : `${fragor.length - unika.size} upprepade`);
  console.log(dov(`\n  Första frågan: ${trunkera((fragor[0].question || fragor[0].q || ''), 110)}`));
  return p;
}

const PROVTEXT = `Hjärtsvikt med nedsatt ejektionsfraktion (HFrEF) behandlas med fyra läkemedelsgrupper:
ACE-hämmare eller ARNI, betablockerare, mineralkortikoidreceptorantagonist och SGLT2-hämmare.
Behandlingen ska titreras till måldos. Diuretika lindrar symtom men förbättrar inte överlevnaden.
NT-proBNP används för att utesluta hjärtsvikt vid akut dyspné; ett normalt värde gör diagnosen osannolik.
Ekokardiografi är förstahandsundersökning och skiljer nedsatt från bevarad ejektionsfraktion.`;

const trunkera = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// ------------------------------------------------------------------ projektlås
/** Låset ligger i The Work List — det är listan båda noderna läser. */
function las_(rest) {
  const wl = path.join(DIR, '..', 'the-work-list', 'worklist.js');
  if (!finns(wl)) { console.error('Hittar inte the-work-list/worklist.js — kan inte låsa projektet.'); return 1; }
  const r = spawnSync(process.execPath, [wl, 'las', 'quiz-runner', ...rest], { stdio: 'inherit' });
  return r.status ?? 0;
}

// ------------------------------------------------------------------ deploy
/** Vercel-CLI:t läser sin inloggning ur XDG_DATA_HOME. På den här maskinen ligger
 *  token i %APPDATA%\\xdg.data\\com.vercel.cli\\auth.json, men variabeln är satt i
 *  Marcs eget skal — inte i miljön ett schemalagt jobb ärver. Utan den svarar
 *  CLI:t "No existing credentials found", som om kontot vore utloggat. Samma
 *  lösning som the-work-list använder. */
function vercelEnv() {
  const env = { ...process.env };
  const har = (rot) => rot && finns(path.join(rot, 'com.vercel.cli', 'auth.json'));
  if (har(env.XDG_DATA_HOME)) return env;
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const funnen = [path.join(appdata, 'xdg.data'), path.join(os.homedir(), '.local', 'share'), appdata].find(har);
  if (funnen) env.XDG_DATA_HOME = funnen;
  else console.log(gul('  Hittar ingen vercel-auth.json — deployen kommer be om inloggning.'));
  return env;
}

/** Vercels dygnstak (`api-deployments-free-per-day`) gäller HELA kontot, och —
 *  det dyrköpta — **varje nekat försök verkar hålla fönstret öppet**. Ett jobb
 *  som provar varje timme gör därför blockeringen permanent (radcore satt
 *  utelåst ett dygn på just det). Rätt svar är tystnad: ett försök per fönster,
 *  sex timmar tyst efter ett nekande, stämpeln rensas vid lyckad deploy.
 *  Samma spärr som `gadget-drop/pipeline/deploy_site.py` och marcs-resell har. */
const BACKOFF_FIL = path.join(DIR, '.deploy-backoff.json');
const BACKOFF_TIMMAR = 6;
function backoffKvar() {
  try {
    const b = JSON.parse(las(BACKOFF_FIL));
    const till = Date.parse(b.nastaForsok);
    if (!Number.isFinite(till) || till <= Date.now()) return 0;
    return Math.round((till - Date.now()) / 60000);
  } catch { return 0; }
}
function backoffSatt(orsak) {
  const nasta = new Date(Date.now() + BACKOFF_TIMMAR * 3600000).toISOString();
  try { fs.writeFileSync(BACKOFF_FIL, JSON.stringify({ nastaForsok: nasta, orsak, satt: new Date().toISOString() }, null, 2), 'utf8'); } catch { /* skrivskyddad mapp */ }
  return nasta;
}
function backoffRensa() { try { fs.unlinkSync(BACKOFF_FIL); } catch { /* fanns inte */ } }

function deploy() {
  if (!harFlagga('--ja')) {
    console.log('Deploy körs bara med --ja:  node quizcli.js deploy --ja');
    console.log(dov('  (Vercel: 100 deploys per DYGN och KONTO. Kör audit + smoke först.)'));
    return 1;
  }
  const kvar = backoffKvar();
  if (kvar && !harFlagga('--anda')) {
    console.log(gul(`Vercel nekade senast — nästa försök om ${Math.floor(kvar / 60)} h ${kvar % 60} min.`));
    console.log(dov('  Varje nekat försök håller dygnsfönstret öppet, så det här är avsiktlig tystnad.'));
    console.log(dov('  --anda kör ändå (gör det bara om du VET att fönstret släppt).'));
    return 4;
  }
  // `vercel` ligger inte på PATH här — npx hämtar den. Node vägrar dessutom
  // spawna .cmd-filer direkt sedan CVE-2024-27980, så vägen går via cmd.exe
  // med ett enda kommandosträngsargument (inte shell:true + array, som varken
  // citerar argumenten eller går att lita på).
  const kommando = 'npx --yes vercel@latest deploy --prod --yes';
  console.log(dov(`  ${kommando}`));
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', kommando],
    { cwd: DIR, encoding: 'utf8', timeout: 6 * 60 * 1000, windowsHide: true, env: vercelEnv() });
  const ut = `${r.stdout || ''}\n${r.stderr || ''}`.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  if (r.status !== 0) {
    console.error(rod(`Deployen misslyckades (${r.status}):`));
    console.error(ut.slice(-900).trim());
    if (/api-deployments-free-per-day/.test(ut)) {
      const nasta = backoffSatt('api-deployments-free-per-day');
      console.error(gul(`Dygnstaket på kontot är nått. Nästa försök tidigast ${new Date(nasta).toLocaleString('sv-SE')} — `
        + 'banka inte, det håller bara fönstret öppet.'));
      return 4;
    }
    return 1;
  }
  backoffRensa();
  // Vercel skriver både produktionsaliaset och en oföränderlig bygg-URL. Det är
  // aliaset som är sajten — den andra fryser en version som ser live ut.
  const alias = ut.match(/Aliased\s+(https:\/\/[^\s]+)/) || ut.match(/Production:\s+(https:\/\/[^\s]+)/);
  const adress = alias ? alias[1] : (ut.match(/https:\/\/[^\s]+\.vercel\.app/) || [])[0] || null;
  console.log(gron(`Publicerad: ${adress || 'se utskriften ovan'}`));
  return 0;
}

// ------------------------------------------------------------------ report
async function rapport() {
  const delar = [audit(), modeller(), storlek(), await smoke(), await prov()];
  if (harFlagga('--ai')) delar.push(await ai());
  for (const d of delar) d.skriv();
  const fel = delar.reduce((a, d) => a + d.fel_, 0);
  const varn = delar.reduce((a, d) => a + d.varningar, 0);

  const rader = [`# Quiz Rush — teknisk rapport`, '',
    `Skriven av \`quizcli.js\` ${new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}.`,
    `**${fel} fel · ${varn} varningar** över ${delar.reduce((a, d) => a + d.rader.length, 0)} kontroller.`, ''];
  for (const d of delar) {
    rader.push(`## ${d.rubrik}`, '');
    for (const r of d.rader) rader.push(`- ${r.niva === 'ok' ? '✓' : r.niva === 'varning' ? '!' : '✗'} **${r.namn}**${r.detalj ? ` — ${r.detalj}` : ''}`);
    rader.push('');
  }
  const fil = path.join(DIR, 'RAPPORT.md');
  fs.writeFileSync(fil, rader.join('\n'), 'utf8');
  console.log(`\nRapport skriven: ${fil}`);

  if (harFlagga('--worklist')) {
    const id = flag('--uppdrag');
    const wl = path.join(DIR, '..', 'the-work-list', 'worklist.js');
    if (id && finns(wl)) {
      spawnSync(process.execPath, [wl, 'note', id, `quizcli: ${fel} fel, ${varn} varningar över ${delar.reduce((a, d) => a + d.rader.length, 0)} kontroller`, '--ingen-bild'], { stdio: 'inherit' });
    } else console.log(dov('  --worklist kräver --uppdrag <id>'));
  }
  return fel ? 1 : 0;
}

// ------------------------------------------------------------------ main
async function main() {
  const cmd = (process.argv[2] || 'help').toLowerCase();
  switch (cmd) {
    case 'audit': return audit().skriv().fel_ ? 1 : 0;
    case 'models': case 'modeller': return modeller().skriv().fel_ ? 1 : 0;
    case 'smoke': case 'rokprov': return (await smoke()).skriv().fel_ ? 1 : 0;
    case 'prov': case 'verify': return (await prov()).skriv().fel_ ? 1 : 0;
    case 'perf': return (await perf()).skriv().fel_ ? 1 : 0;
    case 'size': case 'storlek': return storlek().skriv().fel_ ? 1 : 0;
    case 'ai': return (await ai()).skriv().fel_ ? 1 : 0;
    case 'report': case 'rapport': return rapport();
    case 'las': case 'lås': case 'claim': return las_(process.argv.slice(3));
    case 'deploy': return deploy();
    case 'serve': {
      const s = await serva(PORT);
      const adr = bas(s);
      // En glömd serve höll porten i tio timmar och fällde både prov och smoke
      // nästa morgon. Nu lägger den ner sig själv, och alltid på Ctrl+C.
      const minuter = flag('--minuter') == null ? 120 : Number(flag('--minuter'));
      console.log(`Spelet: ${adr}/index.html   (Ctrl+C avslutar · pid ${process.pid})`);
      console.log(dov(`  Demo:     ${adr}/index.html?demo=dragon&dist=600&debug=1`));
      console.log(dov(`  Självtest: ${adr}/index.html?demo=jungle&selftest=1`));
      if (minuter > 0) console.log(dov(`  Stänger av sig själv efter ${minuter} min (--minuter 0 = aldrig)`));
      await new Promise((klar) => {
        let stanger = false;
        const stang = (varfor) => {
          if (stanger) return; stanger = true;
          console.log(dov(`\n${varfor} — stänger servern och släpper port ${s.address()?.port ?? PORT}`));
          stoppa(s);
          setTimeout(klar, 300).unref();
        };
        for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, () => stang(sig)); } catch {} }
        if (minuter > 0) setTimeout(() => stang(`${minuter} minuter gick`), minuter * 60000).unref();
      });
      return 0;
    }
    default:
      console.log(las(__filename).split('\n').slice(2, 27).map((l) => l.replace(/^ \* ?/, '').replace(/^\/\*\*?/, '')).join('\n'));
      return 0;
  }
}

main().then((k) => { process.exitCode = k || 0; }).catch((e) => { console.error(rod(`quizcli: ${e.stack || e.message}`)); process.exitCode = 1; });
