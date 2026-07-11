# Videobakgrunder per värld

Spelet letar automatiskt efter en MP4-fil per värld i den här mappen och
använder den som levande bakgrund bakom 3D-scenen. Finns ingen fil används
en inbyggd animerad bakgrund (fiskar/bubblor under vatten, moln/fåglar i
djungeln, norrsken i arktis, glödande aska i drakgrottan osv).

## Filnamn (exakta)

| Värld       | Filnamn          |
|-------------|------------------|
| Djungel     | `jungle.mp4`     |
| Under vatten| `underwater.mp4` |
| Stad        | `city.mp4`       |
| Ormgrop     | `snakepit.mp4`   |
| Arktis      | `arctic.mp4`     |
| Ocean       | `ocean.mp4`      |
| Drakgrotta  | `dragon.mp4`     |

## Generera med AI (Gemini Veo, Sora m.fl.)

1. Gå till t.ex. [Google Gemini](https://gemini.google.com) (Veo) eller annan videogenerator.
2. Be om en **loopbar** bakgrundsvideo, t.ex.:
   - *"Seamless looping underwater ocean background, schools of tropical fish, sun rays through blue water, no camera movement, 10 seconds"*
   - *"Seamless looping lush jungle canopy background, birds flying, sunny day, gentle breeze, static camera, 10 seconds"*
3. Ladda ner som MP4 (H.264, gärna 1280×720 — större behövs inte som bakgrund).
4. Döp filen enligt tabellen ovan och lägg den i den här mappen.
5. Starta om spelet — videon spelas automatiskt i bakgrunden av rätt värld.

Tips: korta klipp (5–15 s) som loopar sömlöst ger bäst resultat och laddar snabbt.
