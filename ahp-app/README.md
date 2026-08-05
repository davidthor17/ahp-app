# A·H·P Audit Console

## Keyra staðbundið
```
npm install
npm run dev
```
Opnast á http://localhost:5173

## Setja á netið (Vercel — ókeypis)
Auðveldasta leiðin, engin GitHub-tenging nauðsynleg:
```
npm install -g vercel
vercel
```
Fylgdu leiðbeiningunum sem birtast (skráðu þig inn / stofnaðu reikning ef þarf).
Eftir fyrstu keyrslu gefur `vercel` þér slóð eins og `https://ahp-audit-app.vercel.app`.

Til að setja beinar breytingar upp aftur seinna: `vercel --prod`

## Setja á netið (GitHub + Vercel — sjálfvirkt við hvert push)
1. Stofna repo á github.com, `git init && git add . && git commit -m "init" && git push`
2. Á vercel.com → "Add New Project" → veldu repo-ið
3. Vercel finnur sjálfkrafa að þetta er Vite-verkefni — ýttu bara á Deploy

## Setja upp í símanum (PWA)
Þegar slóðin er komin (Vercel eða annað): opna hana í Safari (iOS) eða Chrome (Android) →
"Add to Home Screen" / "Install app". Virkar þá eins og native app, líka án nets
(app-skelin er kestrar í cache af service worker-inum sem `vite-plugin-pwa` býr til).

## Supabase
`SUPABASE_URL` og `SUPABASE_ANON_KEY` eru þegar sett í `src/App.jsx`.
Skemað er keyrt (properties / audits / audit_items), RLS er virkt.

## Vantar ennþá
- App-íkonin (`icon-192.png`, `icon-512.png`) í `public/` — vísað í frá `vite.config.js`.
  Settu inn þín eigin, eða láttu mig útbúa einföld út frá A·H·P merkinu.
- Tengja markaðssíðuna við sömu Supabase-töflur (les `published` úttektir).
