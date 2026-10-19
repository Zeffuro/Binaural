export interface Moodscape {
  id: string;
  name: string;
  url: string;
  author: string;
  source: string;
  license: 'CC0-1.0';
}

const asset = (name: string) => `${import.meta.env.BASE_URL}moodscapes/${name}.webp`;

export const moodscapes: readonly Moodscape[] = [
  {
    id: 'forest-slope',
    name: 'Forest slope',
    url: asset('forest-slope'),
    author: 'Andreas Mischok',
    source: 'https://polyhaven.com/a/forest_slope',
    license: 'CC0-1.0',
  },
  {
    id: 'mountain-dawn',
    name: 'Mountain dawn',
    url: asset('kiara-dawn'),
    author: 'Greg Zaal',
    source: 'https://polyhaven.com/a/kiara_1_dawn',
    license: 'CC0-1.0',
  },
  {
    id: 'autumn-meadow',
    name: 'Autumn meadow',
    url: asset('autumn-field'),
    author: 'Sergej Majboroda',
    source: 'https://polyhaven.com/a/autumn_field',
    license: 'CC0-1.0',
  },
];
