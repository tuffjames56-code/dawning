// Curated starter slur list used as the default value of the
// `automod_slur_list` setting. Categorised so an admin reviewing it knows
// what they're enabling. The normaliser in automod/index.js already catches
// leet substitutions and spacing bypasses, so we only list base forms.
//
// NOT INCLUDED on purpose:
//   - mild profanity (fuck, shit, ass, etc.) — these aren't slurs, the owner
//     explicitly didn't want them filtered
//   - reclaimed terms with both slur and non-slur uses (high false-positive
//     risk in community speech)
//
// Admins can edit the live list at any time from the settings panel:
//   /admin-config-set key:automod_slur_list value:term1,term2,term3
// (Setting the value to empty disables the slur filter entirely.)

const SLURS_BY_CATEGORY = {
  antiBlack:        ['nigger', 'nigga', 'coon', 'jigaboo', 'porchmonkey', 'spook'],
  antiAsian:        ['chink', 'gook', 'jap', 'slope', 'chinaman'],
  antiHispanic:     ['spic', 'beaner', 'wetback'],
  antiJewish:       ['kike', 'yid', 'heeb'],
  antiArab:         ['raghead', 'sandnigger', 'towelhead'],
  antiRoma:         ['gypsy', 'gyppo'],
  homophobic:       ['faggot', 'fag', 'dyke', 'queer'],
  transphobic:      ['tranny', 'trannie', 'shemale'],
  ableist:          ['retard', 'retarded', 'tard', 'mongoloid'],
  misc:             ['cunt', 'whore', 'twat'],
};

export const DEFAULT_SLUR_LIST = Object.values(SLURS_BY_CATEGORY).flat().join(',');
