// electron-builder afterPack hook: Electron fuses, then Widevine VMP signing (castlabs EVS), in this order.
//
// electron-builder would flip the fuses after this hook, which changes the Electron binary and would break
// a VMP signature made here: the fuses are flipped here instead (the "electronFuses" config stays unset).
// macOS: VMP must come before code signing, so the app is ad-hoc signed again afterwards when no real
// identity is used. Windows: VMP must come after code signing; the app isn't code signed yet (when it is,
// move the Windows part to an afterSign hook).
const { execFileSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

function python() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function vmpSign(appOutDir) {
  if (!process.env.EVS_ACCOUNT_NAME) {
    console.warn('  • VMP: credenziali EVS assenti (EVS_ACCOUNT_NAME, EVS_PASSWD), firma Widevine saltata: Netflix e simili non funzioneranno in questa build');
    return;
  }
  console.log(`  • VMP: firma Widevine di ${appOutDir}`);
  execFileSync(python(), ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir], { stdio: 'inherit' });
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    // Re-signed below on macOS, after VMP.
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // Needed: the browser UI is loaded from file:// inside app.asar.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });

  // Widevine VMP exists on Windows and macOS only.
  if (platform === 'darwin' || platform === 'win32') vmpSign(context.appOutDir);

  if (platform === 'darwin' && process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') {
    const app = readdirSync(context.appOutDir).find((f) => f.endsWith('.app'));
    if (app) execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(context.appOutDir, app)], { stdio: 'inherit' });
  }
};
