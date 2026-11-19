# gonk logo

Files (all SVG):

| File | Use |
| --- | --- |
| `gonk-mark-light.svg`, `gonk-mark-dark.svg` | The mark alone. Favicon, avatar, small places. |
| `gonk-mark-mono.svg` | The mark in one colour, for print or a single-ink place. |
| `gonk-wordmark-light.svg`, `gonk-wordmark-dark.svg` | The wordmark, for a README header. |
| `alternates/` | The other directions that were drawn: g-tile, o. |

Light files are for light backgrounds and dark files for dark ones. In a README, a `<picture>` element picks the right one:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo/gonk-wordmark-dark.svg">
  <img src="docs/logo/gonk-wordmark-light.svg" alt="gonk" height="64">
</picture>
```

Only SVG is kept in git. A PNG at any size comes from `rsvg-convert -w 32 <file>.svg -o <file>.png`.

The README banner (`assets/banner.png`) stays the header. `gonk-wordmark-*.svg` is that banner's wordmark traced to vector, without the metal texture; the mark is its g on the magenta line.
