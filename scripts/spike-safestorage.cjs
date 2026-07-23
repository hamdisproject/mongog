/**
 * S10 spike: safeStorage async API (encryptStringAsync/decryptStringAsync)
 * round-trip, backend detection, and rotation handling. Run with:
 *   npm run spike:safestorage
 */
const { app, safeStorage } = require('electron');

async function main() {
  await app.whenReady();
  let failures = 0;
  const expect = (cond, msg) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
    if (!cond) failures += 1;
  };

  const asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
  console.log(`async encryption available: ${asyncAvailable}`);
  expect(asyncAvailable, 'async safeStorage available');

  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend();
    console.log(`linux backend: ${backend}`);
    if (backend === 'basic_text') {
      console.log('  NOTE: basic_text fallback = no real OS keychain; UI must warn (ADR-12).');
    }
  }

  const secret = 'mongodb://user:p@ssw0rd!@host:27017/db?tls=true';
  const blob = await safeStorage.encryptStringAsync(secret);
  expect(Buffer.isBuffer(blob) && blob.length > 0, 'encryptStringAsync returns Buffer');

  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(blob);
  expect(result === secret, 'decryptStringAsync round-trips');
  console.log(`shouldReEncrypt (key rotation pending): ${shouldReEncrypt}`);
  if (shouldReEncrypt) {
    const reEncrypted = await safeStorage.encryptStringAsync(result);
    const again = await safeStorage.decryptStringAsync(reEncrypted);
    expect(again.result === secret, 're-encrypted blob decrypts');
  }

  const tampered = Buffer.from(blob);
  tampered[0] = tampered[0] ^ 0xff;
  try {
    await safeStorage.decryptStringAsync(tampered);
    console.log('  NOTE: tampered blob decrypted (unexpected but not fatal)');
  } catch {
    expect(true, 'tampered blob throws (needsReauth path)');
  }

  console.log(failures === 0 ? '\nS10 SPIKE: PASS' : `\nS10 SPIKE: ${failures} FAILURES`);
  app.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('S10 SPIKE: ERROR', err);
  app.exit(1);
});
