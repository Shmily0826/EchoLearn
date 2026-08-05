// Temporary diagnostic: compare Free Dictionary vs Datamuse, and simulate lookupWord.
const FD = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DM = 'https://api.datamuse.com/words';

const words = ['running','wanted','cities','quickly',"don't",'better','children','played','going','watched','happily','self-driving','USA','youtube','definitely','really','usually','makes','taken','speaker','knew','driven','unable','friendly','luckily','well-known',"isn't","i'm","you're","he's","we're","can't","won't",'know','learned','quickly'];

async function freeDict(word){
  try{
    const r = await fetch(`${FD}/${encodeURIComponent(word)}`);
    return r.status;
  }catch(e){ return 'ERR'; }
}
async function datamuseHasDef(word){
  try{
    const r = await fetch(`${DM}?sp=${encodeURIComponent(word)}&md=d&max=5`);
    const a = await r.json();
    const w = word.toLowerCase();
    return a.some(x=>x.word && x.word.toLowerCase()===w && Array.isArray(x.defs) && x.defs.length>0);
  }catch(e){ return 'ERR'; }
}

// simulate current lookupWord: candidates = [lemma, cleaned, hyphen parts, -ly root]
function lemmatizeSimple(w){ return w; } // we only care about datamuse coverage of each candidate; use cleaned forms below

const candidatesFor = {
  'running':['run','running'],
  'wanted':['want','wanted'],
  'cities':['city','cities'],
  'quickly':['quick','quickly'],
  "don't":['do',"don't"],
  'better':['good','better'],
  'children':['child','children'],
  'played':['play','played'],
  'going':['go','going'],
  'watched':['watch','watched'],
  'happily':['happily'],
  'self-driving':['self','driving','selfdriving','self-driving'],
  'USA':['usa'],
  'youtube':['youtube'],
  'definitely':['definite','definitely'],
  'really':['real','really'],
  'usually':['usual','usually'],
  'makes':['make','makes'],
  'taken':['take','taken'],
  'speaker':['speak','speaker'],
  'knew':['know','knew'],
  'driven':['drive','driven'],
  'unable':['unable'],
  'friendly':['friend','friendly'],
  'luckily':['lucky','luckily'],
  'well-known':['well','known','wellknown','well-known'],
  "isn't":['is',"isn't"],
  "i'm":['i',"i'm"],
  "you're":['you',"you're"],
  "he's":['he',"he's"],
  "we're":['we',"we're"],
  "can't":['can',"can't"],
  "won't":['will',"won't"],
  'know':['know'],
  'learned':['learn','learned'],
};

console.log('WORD | FD_status | DM_has_def | DM_any_candidate_has_def');
for(const w of words){
  const fd = await freeDict(w);
  const dm = await datamuseHasDef(w);
  const cands = candidatesFor[w] || [w];
  let anyCand = false;
  for(const c of cands){ if(await datamuseHasDef(c)) anyCand = true; }
  console.log(`${w.padEnd(14)} | ${String(fd).padEnd(9)} | ${String(dm).padEnd(10)} | ${anyCand}`);
}
