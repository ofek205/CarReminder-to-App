/**
 * One-shot iOS signing setup via App Store Connect API.
 *
 * Reads the .p8 API key from disk, generates a 2048-bit RSA private key
 * + CSR locally, asks Apple to issue an Apple Distribution certificate
 * for the team, ensures the bundle ID is registered, creates an App
 * Store provisioning profile linking them, then bundles the cert +
 * key into a password-protected .p12 and base64-encodes the .p12 and
 * the profile.
 *
 * Output: prints three values for the user to paste into GitHub
 * repository secrets.
 *
 * USAGE (from project root):
 *   node scripts/setup-ios-signing.cjs
 *
 * Prerequisites:
 *   - AuthKey_<KEY_ID>.p8 lives in the project root
 *   - npm i jsonwebtoken node-forge (already installed transiently)
 */
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const jwt   = require('jsonwebtoken');
const forge = require('node-forge');

// --- Constants for THIS project ---
const KEY_ID         = 'F2K9DCJR2Z';
const ISSUER_ID      = '9bfbeba5-f9e7-4d9d-8c98-7dda6d4256b6';
const TEAM_ID        = 'L36CBSRNZT';
const BUNDLE_ID      = 'com.carreminders.app';
const PROFILE_NAME   = 'CarReminder App Store';
const P12_PASSWORD   = 'cr-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
const KEY_FILE       = path.resolve(__dirname, '..', `AuthKey_${KEY_ID}.p8`);

if (!fs.existsSync(KEY_FILE)) {
  console.error(`ERROR: ${KEY_FILE} not found.`);
  process.exit(1);
}

// --- App Store Connect JWT ---
const signApiToken = () => {
  const privateKey = fs.readFileSync(KEY_FILE, 'utf8');
  return jwt.sign(
    {
      iss: ISSUER_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 19,  // 19 min, max 20
      aud: 'appstoreconnect-v1',
    },
    privateKey,
    { algorithm: 'ES256', keyid: KEY_ID, header: { alg: 'ES256', kid: KEY_ID, typ: 'JWT' } }
  );
};

// --- Generic API request helper ---
const apiRequest = (method, urlPath, body, token) => new Promise((resolve, reject) => {
  const opts = {
    hostname: 'api.appstoreconnect.apple.com',
    path: urlPath,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  const req = https.request(opts, (res) => {
    let chunks = '';
    res.on('data', (c) => (chunks += c));
    res.on('end', () => {
      const json = chunks ? JSON.parse(chunks) : {};
      resolve({ status: res.statusCode, body: json });
    });
  });
  req.on('error', reject);
  if (body) req.write(JSON.stringify(body));
  req.end();
});

// --- Step 1 — Generate RSA private key + CSR locally ---
const buildKeyAndCsr = () => {
  console.log('[1/7] Generating 2048-bit RSA key + CSR…');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr  = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: 'commonName',    value: 'CarReminder Distribution' },
    { name: 'countryName',   value: 'IL' },
    { name: 'emailAddress',  value: 'ofek205@gmail.com' },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrDer: Buffer.from(forge.asn1.toDer(forge.pki.certificationRequestToAsn1(csr)).getBytes(), 'binary'),
  };
};

// --- Step 2 — Submit CSR, get back .cer ---
const requestDistributionCertificate = async (csrDer, token) => {
  console.log('[2/7] Submitting CSR to App Store Connect → requesting DISTRIBUTION cert…');
  const resp = await apiRequest('POST', '/v1/certificates', {
    data: {
      type: 'certificates',
      attributes: {
        certificateType: 'DISTRIBUTION',
        csrContent: csrDer.toString('base64'),
      },
    },
  }, token);
  if (resp.status !== 201) {
    if (resp.status === 409 || (resp.body.errors && resp.body.errors.some(e => e.code === 'ENTITY_ERROR.RELATIONSHIP.INVALID'))) {
      throw new Error(`Cert creation rejected: ${JSON.stringify(resp.body, null, 2)}\n\nIf you already have a Distribution cert, you may need to revoke it first or set USE_EXISTING_CERT=1.`);
    }
    throw new Error(`Status ${resp.status}: ${JSON.stringify(resp.body, null, 2)}`);
  }
  const certB64 = resp.body.data.attributes.certificateContent;
  const certId  = resp.body.data.id;
  console.log(`     ✓ cert id ${certId}`);
  return { certId, certDer: Buffer.from(certB64, 'base64') };
};

// --- Step 3 — Find or create the Bundle ID resource ---
const ensureBundleId = async (token) => {
  console.log('[3/7] Checking bundle id registration…');
  const resp = await apiRequest('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}`, null, token);
  if (resp.status === 200 && resp.body.data && resp.body.data.length) {
    const id = resp.body.data[0].id;
    console.log(`     ✓ already registered (${id})`);
    return id;
  }
  console.log('     creating new bundle id…');
  const createResp = await apiRequest('POST', '/v1/bundleIds', {
    data: {
      type: 'bundleIds',
      attributes: { identifier: BUNDLE_ID, name: 'CarReminder', platform: 'IOS' },
    },
  }, token);
  if (createResp.status !== 201) throw new Error(`Bundle ID create failed: ${JSON.stringify(createResp.body, null, 2)}`);
  console.log(`     ✓ created (${createResp.body.data.id})`);
  return createResp.body.data.id;
};

// --- Step 4 — Create App Store provisioning profile ---
const createProvisioningProfile = async (bundleResourceId, certId, token) => {
  console.log('[4/7] Creating App Store provisioning profile…');
  // Profiles only allow letters/numbers/spaces in some pipelines; check for existing first.
  const listResp = await apiRequest('GET', `/v1/profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}`, null, token);
  if (listResp.status === 200 && listResp.body.data && listResp.body.data.length) {
    // Delete the existing one so the new cert is bound.
    const oldId = listResp.body.data[0].id;
    console.log(`     existing profile ${oldId} — deleting so we can re-create with new cert…`);
    const delResp = await apiRequest('DELETE', `/v1/profiles/${oldId}`, null, token);
    if (delResp.status !== 204) console.warn(`     delete returned status ${delResp.status} — proceeding anyway`);
  }
  const resp = await apiRequest('POST', '/v1/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleResourceId } },
        certificates: { data: [{ type: 'certificates', id: certId }] },
      },
    },
  }, token);
  if (resp.status !== 201) throw new Error(`Profile create failed: ${JSON.stringify(resp.body, null, 2)}`);
  const profileB64 = resp.body.data.attributes.profileContent;
  console.log(`     ✓ profile id ${resp.body.data.id}`);
  return Buffer.from(profileB64, 'base64');
};

// --- Step 5 — Bundle .p12 from cert + private key ---
const buildP12 = (privateKeyPem, certDer, password) => {
  console.log('[5/7] Building password-protected .p12…');
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(certDer.toString('binary'))));
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], password, {
    algorithm: '3des',  // legacy, compatible with macOS keychain on the runner
    friendlyName: 'CarReminder Distribution',
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
};

// --- Main ---
(async () => {
  try {
    const token = signApiToken();

    const { privateKeyPem, csrDer }   = buildKeyAndCsr();
    const { certId, certDer }         = await requestDistributionCertificate(csrDer, token);
    const bundleResourceId            = await ensureBundleId(token);
    const profileBytes                = await createProvisioningProfile(bundleResourceId, certId, token);
    const p12Bytes                    = buildP12(privateKeyPem, certDer, P12_PASSWORD);

    console.log('[6/7] Encoding outputs…');
    const p12B64     = p12Bytes.toString('base64');
    const profileB64 = profileBytes.toString('base64');

    // Save artifacts locally too (gitignored — never commit)
    const artifactDir = path.resolve(__dirname, '..', '.ios-signing');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'distribution.p12'), p12Bytes);
    fs.writeFileSync(path.join(artifactDir, 'profile.mobileprovision'), profileBytes);
    fs.writeFileSync(path.join(artifactDir, 'p12-password.txt'), P12_PASSWORD);

    console.log('[7/7] DONE.\n');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  Add these THREE secrets at:');
    console.log('  https://github.com/ofek205/CarReminder-to-App/settings/secrets/actions');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log('SECRET NAME:  IOS_DIST_CERT_BASE64');
    console.log('SECRET VALUE (copy the whole block below, no surrounding spaces):');
    console.log('---begin---');
    console.log(p12B64);
    console.log('---end---\n');

    console.log('SECRET NAME:  IOS_DIST_CERT_PASSWORD');
    console.log('SECRET VALUE:');
    console.log('---begin---');
    console.log(P12_PASSWORD);
    console.log('---end---\n');

    console.log('SECRET NAME:  IOS_PROFILE_NAME');
    console.log('SECRET VALUE:');
    console.log('---begin---');
    console.log(PROFILE_NAME);
    console.log('---end---\n');

    console.log('Local artifacts (gitignored, can be deleted after secrets are added):');
    console.log(`  ${path.join(artifactDir, 'distribution.p12')}`);
    console.log(`  ${path.join(artifactDir, 'profile.mobileprovision')}`);
    console.log(`  ${path.join(artifactDir, 'p12-password.txt')}`);
  } catch (e) {
    console.error('\nFAILED:', e.message);
    process.exit(1);
  }
})();
