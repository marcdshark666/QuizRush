# Quiz Rush — teknisk rapport

Skriven av `quizcli.js` 2026-09-16 22:42:29.
**0 fel · 1 varningar** över 47 kontroller.

## Statisk hälsokoll — index.html, api och sidhuvudet

- ✓ **index.html läst** — 427.9 kB, 6682 rader
- ✓ **JavaScript-syntax** — 1 inline-block, alla parsar
- ✓ **Unika id:n** — 102 element
- ✓ **CDN versionslåsta** — 3 externa resurser
- ✓ **Inga nycklar i klienten** — AI:n går via api/generate.js
- ✓ **Zoom tillåten** — viewport låser inte skalan
- ✓ **prefers-reduced-motion**
- ✓ **aria-live på frågan**
- ✓ **tangentbord**
- ✓ **global felhanterare**
- ✓ **pausar i bakgrunden**
- ✓ **servicearbetare**
- ✓ **manifest**
- ✓ **pixelRatio taklagd**
- ✓ **Inga TODO/FIXME**
- ✓ **api/generate.js parsar** — 10.4 kB
- ✓ **Nyckeln läses ur miljön**
- ✓ **Modellkedja** — gemini-flash-latest → gemini-3.5-flash → gemini-2.5-flash → gemini-flash-lite-latest
- ✓ **.vercelignore skyddar funktionen** — package.json och server.js deployas inte
- ✓ **Världar** — jungle→boulder underwater→shark city→police snakepit→snake arctic→bear ocean→orca dragon→drake

## 3D-modellerna

- ✓ **Bear.glb** — 703.7 kB
- ✓ **Cobra.glb** — 811.1 kB
- ✓ **Flamingo.glb** — 75.6 kB
- ✓ **Orca.glb** — 115.0 kB
- ✓ **Parrot.glb** — 94.8 kB
- ✓ **PoliceF.glb** — 286.8 kB
- ✓ **PoliceM.glb** — 280.7 kB
- ✓ **Shark.glb** — 75.9 kB
- ✓ **Stork.glb** — 75.1 kB
- ✓ **Vulture.glb** — 1090.3 kB
- ✓ **Summa** — 10 modeller, 3608.9 kB

## Viktbudget — vad tittaren laddar ner

- ✓ **index.html** — 427.9 kB → 112.5 kB gzip
- ✓ **js-gltfloader.js** — 94.3 kB → 21.4 kB gzip
- ✓ **Första laddningen** — 133.9 kB gzip (modellerna hämtas per värld)
- ✓ **Modeller vid behov** — 10 st, 3608.9 kB totalt
- ! **Tunga modeller** — models/Cobra.glb 811.1 kB, models/Vulture.glb 1090.3 kB

## Rökprov — spelet startat på riktigt i headless Chrome

- ✓ **jungle** — start 130 ms · ANGLE (Google, Vulkan 1.3.0  · 844 objekt · 759 draw calls

## Funktionsprov — tangentbord, repetition, paus, tillgänglighet

- ✓ **Frågan visas**
- ✓ **Alternativ som noder** — ol,ot
- ✓ **Alternativ nåbart för tangentbord** — tabIndex=0 role=button
- ✓ **aria-live på frågan** — polite
- ✓ **Tangentbordet svarar (1 = A)**
- ✓ **Missad fråga sparas med schema** — 1 post(er), nästa 2026-09-16T20:52
- ✓ **Pausar när fliken göms**
- ✓ **Fortsätter när fliken syns igen**
- ✓ **Rekordnyckeln finns**
- ✓ **Spelet går vidare till nästa fråga**
