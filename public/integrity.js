const encoder = new TextEncoder();
const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyManifest(pinnedKey, envelope) {
  const key = await crypto.subtle.importKey('spki', decode(pinnedKey),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, decode(envelope.signature), encoder.encode(envelope.payload),
  );
  return valid ? JSON.parse(envelope.payload) : null;
}

export async function checkRelease(pinnedKey, envelope, files) {
  const manifest = await verifyManifest(pinnedKey, envelope);
  if (!manifest) return { signatureValid: false, rows: [], allowed: false };
  const received = new Map(await Promise.all([...files].map(async ([id, bytes]) => [id, await digest(bytes)])));
  const rows = compareHashes(manifest.files, received);

  return { signatureValid: true, rows, allowed: rows.every(({ state }) => state === 'match') };
}

export function compareHashes(expected, received) {
  const rows = expected.map(({ id, sha256 }) => {
    const actual = received.get(id) ?? null;
    return { id, expected: sha256, actual, state: actual === sha256 ? 'match' : actual ? 'mismatch' : 'missing' };
  });
  const listed = new Set(expected.map(({ id }) => id));
  for (const [id, actual] of received) {
    if (!listed.has(id)) rows.push({ id, expected: null, actual, state: 'unlisted' });
  }
  return rows;
}

export function stageFiles(files) {
  return new Map(Object.entries(files).map(([id, content]) => [id, encoder.encode(content)]));
}

const allowedSources = new Set(['release-cdn.example']);
export function auditRequests(logs) {
  return logs.filter(({ host }) => !allowedSources.has(host));
}

const startDigest = '0'.repeat(64);
function entryDigest(sequence, event, previous) {
  return digest(encoder.encode(JSON.stringify([sequence, event, previous])));
}

export async function makeRecordChain(events) {
  const chain = [];
  let previous = startDigest;
  for (const event of events) {
    const sequence = chain.length + 1;
    const hash = await entryDigest(sequence, event, previous);
    chain.push({ sequence, event, previous, hash });
    previous = hash;
  }
  return chain;
}

export async function verifyRecordChain(records, checkpoint) {
  let previous = startDigest;
  for (let index = 0; index < records.length; index++) {
    const entry = records[index];
    if (entry.sequence !== index + 1 || entry.previous !== previous ||
        entry.hash !== await entryDigest(entry.sequence, entry.event, previous)) {
      return { structure: false, checkpoint: 'unchecked' };
    }
    previous = entry.hash;
  }
  const matches = checkpoint
    ? checkpoint.sequence === records.length && checkpoint.hash === previous
    : null;
  return { structure: true, checkpoint: matches };
}
