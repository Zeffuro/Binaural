export const butterchurnPresets = [
  {
    "id": "liquid-beats",
    "name": "Liquid Beats",
    "author": "Geiss",
    "originalName": "Geiss - Liquid Beats",
    "source": "https://www.npmjs.com/package/butterchurn-presets/v/2.4.7",
    "license": "MIT"
  },
  {
    "id": "deep-blue",
    "name": "Deep blue",
    "author": "martin",
    "originalName": "martin - deep blue",
    "source": "https://www.npmjs.com/package/butterchurn-presets/v/2.4.7",
    "license": "MIT"
  },
  {
    "id": "gentle-happiness",
    "name": "Gentle happiness",
    "author": "martin",
    "originalName": "martin - gentle happiness 2a",
    "source": "https://www.npmjs.com/package/butterchurn-presets/v/2.4.7",
    "license": "MIT"
  },
  {
    "id": "alien-fish-pond",
    "name": "Alien fish pond",
    "author": "Flexi",
    "originalName": "Flexi - alien fish pond",
    "source": "https://www.npmjs.com/package/butterchurn-presets/v/2.4.7",
    "license": "MIT"
  },
  {
    "id": "blue-mountains",
    "name": "Blue mountains",
    "author": "martin",
    "originalName": "martin - blue mountains",
    "source": "https://www.npmjs.com/package/butterchurn-presets/v/2.4.7",
    "license": "MIT"
  },
  {
    "id": "cool-morning",
    "name": "Cool morning",
    "author": "Martin",
    "originalName": "Martin - cool morning",
    "source": "https://www.npmjs.com/package/butterchurn-presets/v/2.4.7",
    "license": "MIT"
  }
].map(preset => ({ ...preset, url: import.meta.env.BASE_URL + 'presets/' + preset.id + '.json' }));
