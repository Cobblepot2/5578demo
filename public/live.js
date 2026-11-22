import { auditRequests, checkRelease, compareHashes, digest, stageFiles } from './integrity.js';
import { folderFixture } from './folder-fixture.js';
import { liveWords } from './live-strings.js';

const liveOriginal = JSON.parse(folderFixture.envelope.payload);
const liveMarker = '// COMP5578: classroom edit for the integrity check.';

function parseLiveManifest(text) {
  const manifest = JSON.parse(text);
  if (typeof manifest?.release !== 'string' || !Array.isArray(manifest.files) ||
      manifest.files.length < 1 || manifest.files.length > 20) {
    throw new Error('Invalid classroom manifest');
  }
  const ids = new Set();
  for (const item of manifest.files) {
    if (typeof item?.id !== 'string' || !item.id || ids.has(item.id) ||
        typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) {
      throw new Error('Invalid classroom manifest entry');
    }
    ids.add(item.id);
  }
  return manifest;
}

async function digestLiveFiles(files) {
  return new Map(await Promise.all([...files].map(async ([id, bytes]) => [id, await digest(bytes)])));
}

export function setupLiveLab(enabled) {
  if (!enabled) return () => {};
  const field = (id) => document.getElementById(id);
  const fileName = field('liveFileName');
  const source = field('liveFileText');
  const manifestEditor = field('liveManifestText');
  const originalFiles = folderFixture.files;
  let files = { ...originalFiles };
  let language = 'en';
  let serial = 0;
  let result = { status: 'ready' };

  function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  fileName.append(...Object.keys(files).map((id) => {
    const option = element('option', id);
    option.value = id;
    return option;
  }));

  function updateResult() {
    const w = liveWords[language];
    const { status, rows, signature, reason, alerts } = result;
    const [heading, detail, icon] = {
      ready: [w.ready, w.readyNote, '·'],
      running: [w.running, w.runningNote, '…'],
      allowed: [w.allowed, w.approved, '✓'],
      blocked: [w.blocked, w[reason], '×'],
    }[status];
    const panel = field('liveVerdict');
    panel.dataset.state = status;
    const mark = element('span', icon, 'verdict-mark');
    mark.setAttribute('aria-hidden', 'true');
    const message = element('div');
    message.append(element('strong', heading, 'verdict-title'), element('p', detail, 'verdict-note'));
    panel.replaceChildren(mark, message);

    const equal = rows?.filter(({ state }) => state === 'match').length;
    const signals = [
      [w.signature, signature === undefined ? w.unchecked : signature ? w.valid : w.rejected],
      [w.hashOnly, rows ? w.hashCount(equal, rows.length) : w.unchecked],
      [w.log, alerts === undefined ? w.unchecked : alerts ? w.alerts : w.noAlerts],
    ];
    field('liveSignals').replaceChildren(...signals.map(([label, value]) => {
      const tile = element('div', undefined, 'signal');
      tile.append(element('span', label), element('strong', value));
      return tile;
    }));
    const busy = status === 'running';
    field('liveVerify').disabled = busy;
    field('liveSyncManifest').disabled = busy || Object.keys(files).every((id) => files[id] === originalFiles[id]);

    const target = field('liveEvidenceBody');
    target.replaceChildren();
    field('liveEvidence').hidden = !rows;
    if (!rows) return;
    if (!signature) target.append(element('p', w.preview, 'muted'));
    const wrapper = element('div', undefined, 'evidence-scroll');
    const table = element('table');
    const header = table.createTHead().insertRow();
    for (const label of [w.path, w.result, w.expected, w.actual]) {
      const cell = element('th', label);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      tr.append(element('td', row.id), element('td', w[row.state], 'result-' + row.state),
        element('td', row.expected ?? '—', 'hash'), element('td', row.actual ?? '—', 'hash'));
    }
    wrapper.append(table);
    target.append(wrapper);
  }

  async function verify() {
    const ticket = ++serial;
    result = { status: 'running' };
    updateResult();
    let manifest;
    try {
      manifest = parseLiveManifest(manifestEditor.value);
    } catch {
      result = { status: 'blocked', reason: 'invalid' };
      updateResult();
      return;
    }
    try {
      const staged = stageFiles(files);
      // The editor displays pretty JSON. The classroom manifest signs its compact representation.
      const envelope = { ...folderFixture.envelope, payload: JSON.stringify(manifest) };
      const gate = await checkRelease(folderFixture.publicKey, envelope, staged);
      const rows = gate.signatureValid ? gate.rows : compareHashes(manifest.files, await digestLiveFiles(staged));
      if (ticket !== serial) return;
      result = {
        status: gate.allowed ? 'allowed' : 'blocked',
        reason: gate.signatureValid ? 'filesChanged' : 'manifestChanged', rows,
        signature: gate.signatureValid,
        alerts: auditRequests([...staged.keys()].map((id) => ({ host: 'release-cdn.example', id }))).length,
      };
    } catch {
      if (ticket !== serial) return;
      result = { status: 'blocked', reason: 'error' };
    }
    updateResult();
  }

  function markEdited() {
    serial++;
    result = { status: 'ready' };
    updateResult();
  }

  function restore() {
    files = { ...originalFiles };
    fileName.selectedIndex = 0;
    source.value = files[fileName.value];
    manifestEditor.value = JSON.stringify(liveOriginal, null, 2);
    field('liveEvidence').open = false;
    void verify();
  }

  fileName.addEventListener('change', () => { source.value = files[fileName.value]; });
  source.addEventListener('input', () => {
    files[fileName.value] = source.value;
    markEdited();
  });
  manifestEditor.addEventListener('input', markEdited);
  field('liveReset').addEventListener('click', restore);
  field('liveVerify').addEventListener('click', verify);
  field('liveChangeFile').addEventListener('click', () => {
    const id = fileName.value;
    if (!files[id].includes(liveMarker)) files[id] = files[id].slice(0, 4000) + '\n' + liveMarker + '\n';
    source.value = files[id];
    void verify();
  });
  field('liveSyncManifest').addEventListener('click', async () => {
    const ticket = ++serial;
    result = { status: 'running' };
    updateResult();
    try {
      const hashes = await digestLiveFiles(stageFiles(files));
      if (ticket !== serial) return;
      const listed = [...hashes].map(([id, sha256]) => ({ id, sha256 }));
      manifestEditor.value = JSON.stringify({ release: liveOriginal.release, files: listed }, null, 2);
      await verify();
    } catch {
      if (ticket !== serial) return;
      result = { status: 'blocked', reason: 'error' };
      updateResult();
    }
  });

  restore();
  return (lang) => {
    language = lang;
    for (const entry of document.querySelectorAll('[data-live]')) {
      entry.textContent = liveWords[language][entry.dataset.live];
    }
    updateResult();
  };
}
