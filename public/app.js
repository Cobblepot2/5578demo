import { fixtures } from './fixtures.js';
import { copy } from './strings.js';
import { auditRequests, checkRelease, makeRecordChain, stageFiles, verifyRecordChain } from './integrity.js';
import { setupFolderLab } from './folder.js';

const cases = [
  { id: 'T1', envelope: fixtures.manifest, files: fixtures.files },
  { id: 'T3-A', envelope: fixtures.manifest, files: fixtures.changed },
  { id: 'T3-B', envelope: fixtures.untrustedManifest, files: fixtures.changed },
];
const downloadHost = 'release-cdn.example';
const query = new URLSearchParams(location.search);
const selected = cases.findIndex(({ id }) => id.toLowerCase() === query.get('case')?.toLowerCase());
const $ = (id) => document.getElementById(id);
let scenarioIndex = selected < 0 ? 0 : selected;
let language = query.get('lang') === 'zh' ? 'zh' : 'en';
let runState = { status: 'ready' };
let probeState = '';
let auditState = '';
let revision = 0;
const folderView = query.get('view') === 'folder';
const renderFolder = setupFolderLab();

function node(tag, className, content) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content !== undefined) item.textContent = content;
  return item;
}

const t = () => copy[language];
const selector = cases.map(({ id }, index) => {
  const button = node('button', 'scenario');
  button.type = 'button';
  button.append(node('span', 'case-id', id), node('span', 'case-text'), node('span', 'case-arrow', '→'));
  button.lastChild.setAttribute('aria-hidden', 'true');
  button.addEventListener('click', () => choose(index));
  return button;
});
$('scenarios').append(...selector);

function choose(index) {
  if (scenarioIndex === index) return;
  revision++;
  scenarioIndex = index;
  runState = { status: 'ready' };
  $('evidence').open = false;
  render();
}

function render() {
  const words = t();
  const info = words.cases[scenarioIndex];
  const scenario = cases[scenarioIndex];
  const { status, result, alerts, preview } = runState;
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  for (const entry of document.querySelectorAll('[data-copy]')) entry.textContent = words[entry.dataset.copy];
  for (const entry of document.querySelectorAll('[data-label]')) entry.setAttribute('aria-label', words[entry.dataset.label]);
  $('language').textContent = language === 'en' ? '中文' : 'EN';
  $('language').lang = language === 'en' ? 'zh-CN' : 'en';
  $('language').setAttribute('aria-label', words.switchLanguage);
  $('scenarioView').hidden = folderView;
  $('folderView').hidden = !folderView;
  const destination = new URLSearchParams();
  if (!folderView) destination.set('view', 'folder');
  if (language === 'zh') destination.set('lang', 'zh');
  $('viewLink').setAttribute('href', '?' + destination.toString());
  $('viewLink').textContent = folderView
    ? (language === 'zh' ? '场景演示 ↗' : 'Scenario lab ↗')
    : (language === 'zh' ? '文件夹检测 ↗' : 'Folder lab ↗');
  renderFolder(language);
  $('next').disabled = scenarioIndex === cases.length - 1;
  $('scenarioTag').textContent = scenario.id;
  $('scenarioTitle').textContent = info.name;
  $('scenarioDescription').textContent = info.detail;
  selector.forEach((button, index) => {
    button.setAttribute('aria-pressed', String(index === scenarioIndex));
    button.children[1].replaceChildren(
      node('strong', '', words.cases[index].name),
      node('small', '', words.cases[index].hint),
    );
  });
  $('run').textContent = words[status === 'running' ? 'running' : status === 'ready' ? 'run' : 'rerun'];
  $('run').disabled = status === 'running';

  const marks = result
    ? ['pass', result.signatureValid ? 'pass' : 'fail',
      result.signatureValid ? (result.allowed ? 'pass' : 'fail') : 'skip',
      result.allowed ? 'pass' : 'closed']
    : ['idle', 'idle', 'idle', 'idle'];
  $('steps').replaceChildren(...words.steps.map((label, index) => {
    const step = node('li', 'step');
    step.dataset.state = marks[index];
    const stamp = { pass: '✓', fail: '×', skip: '–', closed: '–' }[marks[index]] ?? String(index + 1);
    const description = { pass: words.match, fail: words.blocked, skip: words.skipped, closed: words.blocked }[marks[index]];
    step.append(node('span', 'step-number', stamp), node('span', '', label));
    step.firstChild.setAttribute('aria-hidden', 'true');
    if (description) step.append(node('span', 'sr-only', ' — ' + description));
    return step;
  }));

  const verdictKey = {
    ready: ['ready', 'readyLine', '·'],
    running: ['checking', 'checkingLine', '…'],
    allowed: ['allowed', 'allowedLine', '✓'],
    blocked: ['blocked', result?.signatureValid ? 'blockedFiles' : 'blockedManifest', '×'],
    failure: ['failure', 'failureLine', '!'],
  }[status];
  $('verdict').dataset.state = status;
  const mark = node('span', 'verdict-mark', verdictKey[2]);
  mark.setAttribute('aria-hidden', 'true');
  const message = node('div');
  message.append(node('strong', 'verdict-title', words[verdictKey[0]]),
    node('p', 'verdict-note', words[verdictKey[1]]));
  $('verdict').replaceChildren(mark, message);

  const signals = [
    ['signature', result?.signatureValid ? 'trusted' : 'untrusted'],
    ['resources', !result?.signatureValid ? 'skipped' : result.allowed ? 'checked' : 'mismatches'],
    ['logging', alerts?.length ? 'alerts' : 'noAlerts'],
  ];
  $('signals').replaceChildren(...signals.map(([label, value]) => {
    const signal = node('div', 'signal');
    signal.append(node('span', '', words[label]), node('strong', '', words[result ? value : 'waiting']));
    return signal;
  }));

  $('evidence').hidden = !result;
  const details = $('evidenceBody');
  details.replaceChildren();
  if (result) {
    const meta = node('dl', 'meta');
    meta.append(node('dt', '', words.sourceLabel), node('dd', '', downloadHost),
      node('dt', '', words.keyLabel), node('dd', '', words.pinned));
    details.append(meta);
    if (result.rows.length) {
      const rows = node('div', 'evidence-scroll');
      const table = node('table');
      const header = node('tr');
      for (const label of ['fieldFile', 'fieldExpected', 'fieldActual', 'fieldStatus']) {
        const cell = node('th', '', words[label]);
        cell.scope = 'col';
        header.append(cell);
      }
      const head = node('thead');
      head.append(header);
      const body = node('tbody');
      for (const row of result.rows) {
        const tr = node('tr');
        tr.append(node('td', '', row.id), node('td', 'hash', row.expected ?? '—'),
          node('td', 'hash', row.actual ?? '—'), node('td', 'result-' + row.state, words[row.state]));
        body.append(tr);
      }
      table.append(head, body);
      rows.append(table);
      details.append(rows);
    } else {
      details.append(node('p', 'muted', words.rejectedNote));
    }
    if (preview) {
      const sample = node('div', 'preview');
      sample.append(node('strong', '', words.preview), node('pre', '', preview));
      details.append(sample);
    }
  }
  $('probeResult').textContent = words[probeState] ?? '';
  $('auditResult').textContent = words[auditState] ?? '';
}

$('language').addEventListener('click', () => {
  language = language === 'en' ? 'zh' : 'en';
  render();
});

$('next').addEventListener('click', () => {
  choose(scenarioIndex + 1);
  selector[scenarioIndex].focus();
});

$('run').addEventListener('click', async () => {
  const ticket = ++revision;
  const scenario = cases[scenarioIndex];
  runState = { status: 'running' };
  render();
  try {
    const files = stageFiles(scenario.files);
    const result = await checkRelease(fixtures.publicKey, scenario.envelope, files);
    const alerts = auditRequests([...files.keys()].map((id) => ({ host: downloadHost, id })));
    if (ticket !== revision) return;
    runState = {
      status: result.allowed ? 'allowed' : 'blocked',
      result, alerts,
      preview: result.allowed ? new TextDecoder().decode(files.get('home-screen.txt')) : null,
    };
  } catch {
    if (ticket !== revision) return;
    runState = { status: 'failure' };
  }
  render();
});

$('probe').addEventListener('click', async () => {
  const button = $('probe');
  button.disabled = true;
  try {
    const outcomes = await Promise.all(['A', 'B'].map(() =>
      checkRelease(fixtures.publicKey, fixtures.manifest, stageFiles(fixtures.changed))));
    probeState = outcomes.every(({ signatureValid, rows }) =>
      signatureValid && rows.filter(({ state }) => state === 'mismatch').length === 4) ? 'probeDone' : 'probeFail';
  } catch {
    probeState = 'probeFail';
  } finally {
    button.disabled = false;
    render();
  }
});

const auditEvents = ['Release staged', 'Manifest accepted', 'Resources compared', 'Loading blocked'];
async function checkMissing(mode) {
  $('middle').disabled = true;
  $('tail').disabled = true;
  try {
    const original = await makeRecordChain(auditEvents);
    const last = original.at(-1);
    const checkpoint = { sequence: last.sequence, hash: last.hash };
    const shortened = mode === 'middle' ? original.filter((_, i) => i !== 1) : original.slice(0, -1);
    const local = await verifyRecordChain(shortened);
    const anchored = await verifyRecordChain(shortened, checkpoint);
    if (mode === 'middle' && !local.structure) auditState = 'auditMiddle';
    else if (mode === 'tail' && local.structure && anchored.checkpoint === false) auditState = 'auditTail';
    else auditState = 'auditFail';
  } catch {
    auditState = 'auditFail';
  } finally {
    $('middle').disabled = false;
    $('tail').disabled = false;
    render();
  }
}
$('middle').addEventListener('click', () => checkMissing('middle'));
$('tail').addEventListener('click', () => checkMissing('tail'));
render();
