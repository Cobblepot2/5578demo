# Release Integrity Lab

A browser demo for the COMP5578 Option 2 presentation on runtime resource integrity in the NIKKE PC launcher case.

## Present the demo

Open **Live editor** (`?view=live`) for a two-minute run. The page verifies the pristine sample on load. Click **T3-A · Edit selected file** to append a harmless comment and rerun validation. Then click **T3-B · Match manifest to files** to update the listed fingerprints while keeping the original signature. The hash-only comparison matches, but signature verification blocks loading. You can also type directly into either editor and click **Run verification**. **T1 · Restore original** resets the lab.

Use the scenario lab to replay the predefined cases:

1. Run **T1 / Normal release**. The publisher signature passes and all four files match.
2. Use **Next scenario** and run **T3-A / Files changed**. The download host stays the same and the request audit reports zero alerts. Four differences block loading.
3. Run **T3-B / Manifest replaced**. The replacement manifest matches the changed files, but its signature fails against the pinned publisher key. The launcher stops before resource comparison.

The site opens in English. Use the **中文** button or add `?lang=zh` to switch languages. Add `?case=t3-a` or `?case=t3-b` to select a scenario directly. Expand **Distribution and audit experiments** for the M4 two-node check and D3 missing-record examples.

## Inspect a local folder

Open **Folder lab** (`?view=folder`). Download the sample ZIP and extract its `NIKKE-classroom-sources` folder. Choose that folder for a clean scan. Add a harmless comment to any file, save it, and select that same folder again. The report shows matching, modified, missing and added files, with both SHA-256 values where available.

The archive uses four filenames cited in the incident analysis and contains classroom comments. The signed classroom manifest matches only the archived classroom bytes. For authentic clean copies, choose **Published NIKKE clean hashes**, which uses the case researcher's post-remediation fingerprints. For another release, use **My verified original folder** to record the reference in memory before comparing a second copy. File contents stay in the browser and are never evaluated. Generate a new classroom pack and its matching manifest together with `node scripts/folder-fixtures.mjs`.

## Run locally

With Node.js 22 or later, run:

```sh
npm run dev
npm test
npm run offline
```

The local server listens at `http://127.0.0.1:4173/`. The offline command generates `dist/5578-integrity-demo.html`. Open that file in a current Edge or Chrome browser for the classroom backup.

## Methods and scope

- **D1** verifies the exact manifest bytes using ECDSA P-256 and a pinned public key. It computes SHA-256 over the staged resource bytes. Loading the harmless preview requires a trusted signature and an exact match for every listed file.
- **D2** audits synthetic request entries against a demo host allowlist. It illustrates the scope of request logs.
- **D3** computes a hash chain and compares a shortened copy with a checkpoint held separately from the records inside the model.
- **M4** checks both simulated nodes independently against the signed release. Their matching responses still differ from the trusted baseline.

The launcher, CDN and events are simulations. The fixtures contain harmless text. Browser cryptography actually runs. The demonstration's trust model assumes the verifier and its pinned key are obtained through a trusted channel. Production rollout also requires approved versions and expiry rules, key rotation and a secure per-release pipeline. Generate fresh classroom fixtures with `node scripts/fixtures.mjs`. The generator discards both demo private keys after signing.

## Deployment

Import this Git repository into Vercel or run `vercel deploy --prod` with a signed-in CLI. The project serves the static files in `public/` and needs no environment variables or database.

## References

- [Bitdefender Labs incident analysis](https://www.bitdefender.com/en-gb/blog/labs/nikke-game-launcher-malware)
- [MotherSphere incident timeline and analysis](https://gist.github.com/MotherSphere/d6c049a09ba8ac3085c51ee9df24a4e5)
- [Microsoft Authenticode digital signatures](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/authenticode)
- [The Update Framework specification](https://theupdateframework.github.io/specification/latest/)
