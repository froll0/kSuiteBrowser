import { hydrateIcons } from '../../renderer/icons';
import { internal } from '../shared/bridge';

hydrateIcons();

const params = new URLSearchParams(location.search);
const target = params.get('url') ?? '';
const kind = params.get('kind') === 'malware' ? 'malware' : 'phishing';
let host = target;
try {
  host = new URL(target).host;
} catch {
  /* keep raw */
}

const TEXT = {
  phishing: {
    title: 'Sito ingannevole',
    lead: `${host} potrebbe cercare di rubarti password, dati della carta o altre informazioni personali fingendosi un sito di cui ti fidi.`,
  },
  malware: {
    title: 'Sito che diffonde malware',
    lead: `${host} è segnalato per distribuire software dannoso che potrebbe infettare il computer o rubare i tuoi dati.`,
  },
}[kind];

document.title = TEXT.title;
document.getElementById('title')!.textContent = TEXT.title;
document.getElementById('lead')!.textContent = TEXT.lead;
document.getElementById('host')!.textContent = target;

document.getElementById('back')!.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = 'ksuite://newtab/';
});
const detailsBtn = document.getElementById('details-btn')!;
detailsBtn.addEventListener('click', () => {
  const details = document.getElementById('details')!;
  details.hidden = !details.hidden;
  detailsBtn.setAttribute('aria-expanded', String(!details.hidden));
});
document.getElementById('continue')!.addEventListener('click', () => void internal.threatContinue(target));
