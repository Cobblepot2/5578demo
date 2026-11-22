import { compareHashes, digest, verifyManifest } from './integrity.js';
import { folderFixture } from './folder-fixture.js';
import { folderWords } from './folder-strings.js';

// Clean-copy digests reported in MotherSphere's public incident analysis.
const caseHashes = [
  ['aegis-fix.min.js', '83bb8f30c65fd31208089f4107f316e7073c9b1213a8a3b2b512ab99e261de18'],
  ['images.7fec4c32.js', '4ad53349f98b86fd3a97bc386b2a1f555baf27c27a270f272404d47c9d7cc065'],
  ['FeedList.feb647c9.js', '49b625b30b34dc1fa16edba30bdf63c18b6171a0fc4cf030e21ea4e1263ae18a'],
  ['vue-bucket.min.js', '459343517635a96caa109b050361b4d32393e8727b2f54b44749db783feb4199'],
].map(([id, sha256]) => ({ id, sha256 }));

export async function readFolder(entries) {
  if (!entries.length || entries.length > 1000) throw new Error('Folder file count out of range');
  const root = entries[0].webkitRelativePath.split('/')[0];
  const hashes = new Map();
  for (const item of entries) {
    const path = item.webkitRelativePath.slice(root.length + 1);
    if (!item.webkitRelativePath.startsWith(root + '/') || !path ||
        hashes.has(path) || item.size > 64 * 1024 * 1024) {
      throw new Error('Invalid folder entry');
    }
    hashes.set(path, await digest(await item.arrayBuffer()));
  }
  return { root, hashes };
}

export function setupFolderLab() {
  const field = (id) => document.getElementById(id);
  const mode = field('folderMode');
  const referenceInput = field('referenceInput');
  const candidateInput = field('candidateInput');
  const supported = 'webkitdirectory' in candidateInput;
  let lang = 'en';
  let original = null;
  let report = null;
  let pending = false;
  let issue = false;
  let ticket = 0;
  const words = () => folderWords[lang];

  function el(tag, content, className) {
    const item = document.createElement(tag);
    if (content !== undefined) item.textContent = content;
    if (className) item.className = className;
    return item;
  }

  function verdict(status, title, message) {
    const result = field('folderVerdict');
    result.dataset.state = status;
    const icon = el('span', { allowed: '✓', blocked: '×', failure: '!', running: '…', ready: '·' }[status], 'verdict-mark');
    icon.setAttribute('aria-hidden', 'true');
    const label = el('div');
    label.append(el('strong', title, 'verdict-title'), el('p', message, 'verdict-note'));
    result.replaceChildren(icon, label);
  }

  function renderReport() {
    const w = words();
    field('folderReport').replaceChildren();
    if (!supported) return verdict('failure', w.error, w.noFolder);
    if (pending) return verdict('running', w.reading, w.readingNote);
    if (issue) return verdict('failure', w.error, w.errorNote);
    if (!report) return verdict('ready', w.ready, mode.value === 'custom' && !original ? w.needRef : w.readyNote);

    const { rows, root } = report;
    const stats = ['match', 'mismatch', 'missing', 'unlisted'].map(
      (state) => w[state] + ' ' + rows.filter((row) => row.state === state).length,
    ).join(' · ');
    const passed = rows.every(({ state }) => state === 'match');
    verdict(passed ? 'allowed' : 'blocked', passed ? w.clear : w.changes, stats);

    const target = field('folderReport');
    const meta = el('dl', undefined, 'meta');
    meta.append(el('dt', w.checked), el('dd', mode.value === 'custom' ? original.root : w[mode.value]),
      el('dt', w.scanFolder), el('dd', root));
    const wrapper = el('div', undefined, 'evidence-scroll');
    const table = el('table');
    const header = table.createTHead().insertRow();
    for (const label of [w.file, w.result, w.expected, w.actual]) {
      const cell = el('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      tr.append(el('td', row.id), el('td', w[row.state], 'result-' + row.state),
        el('td', row.expected ?? '—', 'hash'), el('td', row.actual ?? '—', 'hash'));
    }
    wrapper.append(table);
    target.append(meta, wrapper);
  }

  function renderFolder(language = lang) {
    lang = language;
    const w = words();
    for (const entry of document.querySelectorAll('[data-folder]')) entry.textContent = w[entry.dataset.folder];
    field('folderModeHelp').textContent = w[mode.value + 'Help'];
    field('folderEditHelp').textContent = mode.value === 'classroom' ? w.classroomEdit : w.otherEdit;
    field('sampleArchive').hidden = mode.value !== 'classroom';
    field('pickReference').hidden = mode.value !== 'custom';
    field('pickReference').disabled = !supported || pending;
    field('pickCandidate').disabled = !supported || pending || (mode.value === 'custom' && !original);
    field('referenceStatus').textContent = mode.value === 'custom' && original
      ? w.saved + ' · ' + original.root + ' (' + original.hashes.size + ')' : '';
    renderReport();
  }

  mode.addEventListener('change', () => {
    ticket++;
    report = null;
    issue = false;
    pending = false;
    renderFolder();
  });
  field('pickReference').addEventListener('click', () => referenceInput.click());
  field('pickCandidate').addEventListener('click', () => candidateInput.click());

  async function onFolder(input, isReference) {
    const files = [...input.files];
    input.value = ''; // Selecting the same directory after an edit must trigger another read.
    if (!files.length) return;
    const scan = ++ticket;
    pending = true;
    issue = false;
    report = null;
    if (isReference) original = null;
    renderFolder();
    try {
      const folder = await readFolder(files);
      if (scan !== ticket) return;
      if (isReference) {
        original = folder;
      } else {
        let expected = caseHashes;
        if (mode.value === 'custom') {
          expected = [...original.hashes].map(([id, sha256]) => ({ id, sha256 }));
        } else if (mode.value === 'classroom') {
          const verified = await verifyManifest(folderFixture.publicKey, folderFixture.envelope);
          if (scan !== ticket) return;
          if (!verified) throw new Error('Classroom manifest signature did not verify');
          expected = verified.files;
        }
        report = { root: folder.root, rows: compareHashes(expected, folder.hashes) };
      }
    } catch {
      if (scan === ticket) issue = true;
    } finally {
      if (scan === ticket) {
        pending = false;
        renderFolder();
      }
    }
  }

  referenceInput.addEventListener('change', () => onFolder(referenceInput, true));
  candidateInput.addEventListener('change', () => onFolder(candidateInput, false));
  return renderFolder;
}
