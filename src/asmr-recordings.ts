export const recordedAsmrSounds = [
  { id: 'recorded-hands', name: 'Hand rubbing', file: 'hand-rubbing.ogg', description: 'Recorded hands rubbing together' },
  { id: 'recorded-crinkles', name: 'Soft packaging', file: 'soft-crinkles.ogg', description: 'Recorded delicate packaging crinkles' },
  { id: 'recorded-metal', name: 'Metal tapping', file: 'metal-tapping.ogg', description: 'Recorded radiator taps' },
  { id: 'recorded-cloth', name: 'Cloth rustles', file: 'cloth-rustles.ogg', description: 'Recorded blankets and soft fabric' },
  { id: 'recorded-grass', name: 'Grass brushing', file: 'grass-brushing.ogg', description: 'Recorded grass with distant water' },
  { id: 'recorded-pages', name: 'Page turning', file: 'page-turning.mp3', description: 'Recorded paper pages being turned' },
  { id: 'recorded-hair', name: 'Hair brushing', file: 'hair-brushing.mp3', description: 'Recorded brush strokes through hair' },
  { id: 'recorded-spray', name: 'Spray bottle', file: 'spray-bottle.mp3', description: 'Recorded spray pumps and mist' },
  { id: 'recorded-writing', name: 'Pencil writing', file: 'pencil-writing.mp3', description: 'Recorded pencil strokes on paper' },
  { id: 'recorded-blanket', name: 'Blanket folds', file: 'blanket-movement.flac', description: 'Recorded blanket movement and fabric folds' },
  { id: 'recorded-zipper', name: 'Zipper touches', file: 'zipper-slide.flac', description: 'Recorded bag zipper movements' },
  { id: 'recorded-sketchbook', name: 'Sketchbook pages', file: 'sketchbook-pages.flac', description: 'Recorded sketchbook page turns' },
  { id: 'recorded-sketching', name: 'Pencil sketching', file: 'pencil-sketching.flac', description: 'Recorded pencil scratches and drawing strokes' },
  { id: 'recorded-mist', name: 'Bottle mist', file: 'bottle-mist.flac', description: 'Recorded bottle pumps and fine spray' },
  { id: 'recorded-running-water', name: 'Running water', file: 'running-water.flac', description: 'Recorded water flowing from a tap' },
  { id: 'recorded-sketching-long', name: 'Pencil sketching (long take)', file: 'pencil-sketching-long.wav', description: 'A complete alternate take of pencil scratches', maxBytes: 6973156 },
  { id: 'recorded-plastic-lid', name: 'Plastic lid clicks', file: 'plastic-lid-clicks.mp3', description: 'Recorded snaps and pops from a small plastic tube lid' },
  { id: 'recorded-plastic-snap', name: 'Calculator casing snap', file: 'plastic-calculator-snap.mp3', description: 'A crisp snap of calculator plastic against plastic' },
  { id: 'recorded-plastic-toy', name: 'Toy hinge clicks', file: 'plastic-toy-clicks.mp3', description: 'Plastic joints clicking and rattling as a toy is moved' },
  { id: 'recorded-plastic-zip-tie', name: 'Zip tie ratchet', file: 'plastic-zip-tie-clicks.mp3', description: 'Short plastic ratchet clicks as cable ties tighten' },
  { id: 'recorded-plastic-switch', name: 'Plastic light switch', file: 'plastic-light-switch.mp3', description: 'Two tones from a plastic light switch clicking on and off' },
  { id: 'recorded-plastic-pen', name: 'Retractable pen clicks', file: 'plastic-pen-clicks.mp3', description: 'Clicks from extending and retracting a plastic pen' },
  { id: 'recorded-plastic-button', name: 'Plastic push button', file: 'plastic-push-button.mp3', description: 'Clicks from a mechanical plastic push button' },
] as const;

const quietClickSounds = new Set([
  'recorded-plastic-toy', 'recorded-plastic-snap', 'recorded-plastic-lid', 'recorded-plastic-zip-tie',
  'recorded-plastic-switch', 'recorded-plastic-pen', 'recorded-plastic-button',
]);
export const supportsQuietClicks = (sound: string): boolean => quietClickSounds.has(sound);
