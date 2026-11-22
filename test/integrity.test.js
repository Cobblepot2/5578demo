import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtures } from '../public/fixtures.js';
import { auditRequests, checkRelease, digest, makeRecordChain, stageFiles, verifyRecordChain } from '../public/integrity.js';

test('T1 accepts the signed release and exactly four approved files', async () => {
  const result = await checkRelease(fixtures.publicKey, fixtures.manifest, stageFiles(fixtures.files));
  assert.equal(result.signatureValid, true);
  assert.deepEqual(result.rows.map(({ state }) => state), Array(4).fill('match'));
  assert.equal(result.allowed, true);
});

test('T3-A blocks the changed bytes despite an approved host', async () => {
  const files = stageFiles(fixtures.changed);
  assert.equal(auditRequests([{ host: 'release-cdn.example' }]).length, 0);
  const result = await checkRelease(fixtures.publicKey, fixtures.manifest, files);
  assert.equal(result.signatureValid, true);
  assert.deepEqual(result.rows.map(({ state }) => state), Array(4).fill('mismatch'));
  assert.equal(result.allowed, false);
});

test('T3-B rejects a self-consistent manifest from a different key', async () => {
  const files = stageFiles(fixtures.changed);
  const { files: expected } = JSON.parse(fixtures.untrustedManifest.payload);
  for (const { id, sha256 } of expected) assert.equal(await digest(files.get(id)), sha256);
  assert.deepEqual(await checkRelease(fixtures.publicKey, fixtures.untrustedManifest, files),
    { signatureValid: false, rows: [], allowed: false });
});

test('signature does not authorize a modified payload, extra files, or missing files', async () => {
  const files = stageFiles({ ...fixtures.files, 'unexpected.txt': 'Test data only' });
  files.delete('home-screen.txt');
  const result = await checkRelease(fixtures.publicKey, fixtures.manifest, files);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.rows.map(({ state }) => state).sort(), ['match', 'match', 'match', 'missing', 'unlisted']);
  const altered = { ...fixtures.manifest, payload: fixtures.manifest.payload + ' ' };
  assert.equal((await checkRelease(fixtures.publicKey, altered, files)).signatureValid, false);
});

test('D3 distinguishes a broken chain from a valid prefix missing its final entry', async () => {
  const records = await makeRecordChain(['Staged', 'Verified', 'Blocked']);
  const checkpoint = { sequence: 3, hash: records[2].hash };
  assert.deepEqual(await verifyRecordChain(records, checkpoint), { structure: true, checkpoint: true });
  assert.deepEqual(await verifyRecordChain([records[0], records[2]], checkpoint),
    { structure: false, checkpoint: 'unchecked' });
  const prefix = records.slice(0, -1);
  assert.deepEqual(await verifyRecordChain(prefix), { structure: true, checkpoint: null });
  assert.deepEqual(await verifyRecordChain(prefix, checkpoint), { structure: true, checkpoint: false });
});
