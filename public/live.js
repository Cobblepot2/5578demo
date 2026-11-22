import { auditRequests, checkRelease, compareHashes, digest, stageFiles } from './integrity.js';
import { folderFixture } from './folder-fixture.js';
import { liveWords } from './live-strings.js';

const liveOriginal = JSON.parse(folderFixture.envelope.payload);

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
  const listedHash = field('liveListedHash');
  const actualHash = field('liveActualHash');
  const copyHash = field('liveCopyHash');
  const originalFiles = folderFixture.files;
  let files = { ...originalFiles };
  let measured = new Map();
  let copyNotice = '';
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

  function currentEntry(manifest) {
    return Array.isArray(manifest?.files)
      ? manifest.files.find((entry) => entry?.id === fileName.value)
      : undefined;
  }

  function showListedHash() {
    let entry;
    try {
      entry = currentEntry(JSON.parse(manifestEditor.value));
    } catch {
      entry = undefined;
    }
    listedHash.disabled = typeof entry?.sha256 !== 'string';
    listedHash.value = listedHash.disabled ? '' : entry.sha256;
  }

  function showMeasuredHash() {
    const fingerprint = measured.get(fileName.value) ?? '';
    if (actualHash.value !== fingerprint) actualHash.value = fingerprint;
    copyHash.disabled = !actualHash.value;
    const notice = field('liveCopyStatus');
    notice.hidden = !copyNotice;
    notice.textContent = liveWords[language][copyNotice] ?? '';
  }

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
    field('liveVerify').disabled = status === 'running';
    showMeasuredHash();

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
    copyNotice = '';
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
      measured = new Map(rows.filter(({ actual }) => actual !== null).map(({ id, actual }) => [id, actual]));
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
    copyNotice = '';
    result = { status: 'ready' };
    updateResult();
  }

  function restore() {
    files = { ...originalFiles };
    measured.clear();
    fileName.selectedIndex = 0;
    source.value = files[fileName.value];
    manifestEditor.value = JSON.stringify(liveOriginal, null, 2);
    showListedHash();
    field('liveEvidence').open = false;
    void verify();
  }

  fileName.addEventListener('change', () => {
    source.value = files[fileName.value];
    copyNotice = '';
    showListedHash();
    showMeasuredHash();
  });
  source.addEventListener('input', () => {
    files[fileName.value] = source.value;
    measured.delete(fileName.value);
    markEdited();
  });
  manifestEditor.addEventListener('input', () => {
    showListedHash();
    markEdited();
  });
  listedHash.addEventListener('input', () => {
    const manifest = JSON.parse(manifestEditor.value);
    currentEntry(manifest).sha256 = listedHash.value;
    manifestEditor.value = JSON.stringify(manifest, null, 2);
    markEdited();
  });
  copyHash.addEventListener('click', async () => {
    const value = actualHash.value;
    try {
      await navigator.clipboard.writeText(value);
      if (actualHash.value !== value) return;
      copyNotice = 'copied';
    } catch {
      if (actualHash.value !== value) return;
      actualHash.focus();
      actualHash.select();
      copyNotice = 'selectCopy';
    }
    showMeasuredHash();
  });
  field('liveReset').addEventListener('click', restore);
  field('liveVerify').addEventListener('click', verify);

  restore();
  return (lang) => {
    language = lang;
    for (const entry of document.querySelectorAll('[data-live]')) {
      entry.textContent = liveWords[language][entry.dataset.live];
    }
    updateResult();
  };
}
