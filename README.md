# Binaural

A browser studio for binaural beats, ambient sound, music and visualizations.
Includes BWGen preset import, Butterchurn visuals and nature panoramas.
Presets stay in your browser; audio files play locally.

## Run locally

Requires Node 22.12 or later.

```sh
npm ci
npm run dev
```

Use headphones for binaural beats and start at low volume.

## Build and deploy

`npm run build` creates `dist/`; `npm run preview` serves it locally.
For GitHub Pages, select **Settings → Pages → Source → GitHub Actions** and
push to `main`. The included workflow handles the build and deployment.

Run `npm run check` for tests and `npm run check:pages` to check the built site.
Install test browsers first with `npx playwright install chromium firefox`.

## License

[GPL-3.0-only](LICENSE). Bundled visuals and photographs have their own
[credits and licenses](public/credits.html). Keep the source publicly accessible
when deploying through GitHub Pages.
