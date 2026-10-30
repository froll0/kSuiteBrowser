// electron-builder afterSign hook: on Windows, Widevine VMP signing must come after code signing.
// Unsigned builds are VMP-signed in after-pack.cjs instead.
const { vmpSign, windowsCodeSigned } = require('./after-pack.cjs');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName === 'win32' && windowsCodeSigned()) vmpSign(context.appOutDir);
};
