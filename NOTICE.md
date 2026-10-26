# Third-party notices

Air Hockey 3D is distributed under the GNU General Public License version 3 or later (see
[LICENSE](LICENSE)). It includes or depends on the following software.

## three.js — MIT

Copyright © 2010–2026 three.js authors. https://github.com/mrdoob/three.js — MIT License.

## Trystero — MIT

Copyright © 2021 Dan Motzenbecker. https://github.com/dmotz/trystero — MIT License. It connects
two players' browsers for online games: it finds the other player through public Nostr relays and
then opens a direct WebRTC connection.

## noble-secp256k1 — MIT

Copyright © 2019 Paul Miller. https://github.com/paulmillr/noble-secp256k1 — MIT License. Trystero
uses it to sign its Nostr messages.

## QR Code Generator — MIT

Copyright © 2009 Kazuhiko Arase. https://github.com/kazuhikoarase/qrcode-generator — MIT License. It
draws the invitation link as a QR code, in the browser. The word "QR Code" is a registered trademark
of DENSO WAVE INCORPORATED.

## Shared code

The interface, the online layer, the scene and the tooling come from the author's own games, Pool
and Grandmaster 3D (https://github.com/slaviboy/Grandmaster-3D), under the same licence.

## Sound effects — Pixabay Content License

The hits in `public/sounds/` are Pool's, renamed for what they are played for here: short excerpts
cut from recordings published on Pixabay under the Pixabay Content License
(https://pixabay.com/service/license-summary/), which allows them to be used and adapted for free,
without attribution; they are credited here all the same. Each excerpt is a single hit, cut out,
aligned to its attack, faded, normalised and re-encoded (`docs/sounds.md` says which clip comes
from which recording). These files are under the Pixabay Content License, not the GPL.

- *Billiard Sound 02*, *03*, *05* and *6*, *Billiard Hole* and *Billiard Hole 2*, recorded by
  Alex_Jauk:
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-02-288423/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-03-288424/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-05-288416/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-sound-6-288417/,
  https://pixabay.com/sound-effects/film-special-effects-billiard-hole-288419/ and
  https://pixabay.com/sound-effects/film-special-effects-billiard-hole-2-288420/
- *pool_break*, published by freesound_community:
  https://pixabay.com/sound-effects/film-special-effects-pool-break-105353/

## Other assets

The table, the mallets and the puck were modelled for this project with the Blender scripts in
`blender/scripts/`; the playing surface's markings, the score unit's digits and the speckle of the
cabinet are drawn at runtime. The computer's portraits (`public/portraits/`) are the author's own
illustrated level cards from Grandmaster 3D, cropped there. The icons and the game's notes
(synthesised with Web Audio) are original. No third-party models, textures or fonts are included.
