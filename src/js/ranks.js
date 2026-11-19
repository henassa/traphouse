const MM_RANKS = [
  ['Silver I', 'S1'], ['Silver II', 'S2'], ['Silver III', 'S3'], ['Silver IV', 'S4'],
  ['Silver Elite', 'SE'], ['Silver Elite Master', 'SEM'],
  ['Gold Nova I', 'GN1'], ['Gold Nova II', 'GN2'], ['Gold Nova III', 'GN3'], ['Gold Nova Master', 'GNM'],
  ['Master Guardian I', 'MG1'], ['Master Guardian II', 'MG2'], ['Master Guardian Elite', 'MGE'],
  ['Distinguished Master Guardian', 'DMG'], ['Legendary Eagle', 'LE'], ['Legendary Eagle Master', 'LEM'],
  ['Supreme Master First Class', 'SMFC'], ['Global Elite', 'GE'],
];

export const mmName = (rank) => MM_RANKS[rank - 1]?.[0] ?? 'Non classé';
export const mmShort = (rank) => MM_RANKS[rank - 1]?.[1] ?? '—';

export function mmColor(rank) {
  if (!rank) return 'gray';
  if (rank <= 6) return 'gray';
  if (rank <= 10) return 'yellow';
  if (rank <= 14) return 'blue';
  if (rank <= 16) return 'purple';
  return 'red';
}

// Couleurs exactes des paliers Premier de CS2 (reprises de l'overlay Leetify).
export const PREMIER_HEX = { gray: '#b0c3d9', teal: '#8cc6ff', blue: '#6a7dff', indigo: '#c166ff', pink: '#f03cff', red: '#eb4b4b', yellow: '#fed700' };

// Paliers de 5 000 points, comme dans le jeu.
export function premierColor(rating) {
  if (rating == null) return 'gray';
  if (rating < 5000) return 'gray';
  if (rating < 10000) return 'teal';
  if (rating < 15000) return 'blue';
  if (rating < 20000) return 'indigo';
  if (rating < 25000) return 'pink';
  if (rating < 30000) return 'red';
  return 'yellow';
}

export function faceitColor(level) {
  if (!level) return 'gray';
  if (level === 1) return 'gray';
  if (level <= 3) return 'green';
  if (level <= 7) return 'yellow';
  if (level <= 9) return 'orange';
  return 'red';
}

export const SOURCE_LABEL = { faceit: 'FACEIT', premier: 'Premier', mm: 'Compétitif', wingman: 'Wingman', renown: 'Renown', other: 'Autre' };
export const SOURCE_COLOR = { faceit: 'orange', premier: 'blue', mm: 'green', wingman: 'teal', renown: 'purple', other: 'gray' };
