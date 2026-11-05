import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function executable(file) {
  try {
    await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fromPath(command) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

export async function resolveChromePath(env = process.env) {
  const override = env.CHROME_PATH || env.CHROME_EXECUTABLE;
  if (override) {
    if (await executable(override)) return path.resolve(override);
    throw new Error(`CHROME_PATH/CHROME_EXECUTABLE does not point to an executable browser: ${override}`);
  }

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      path.join(env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    );
  } else if (process.platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(base, 'Google/Chrome/Application/chrome.exe'));
      candidates.push(path.join(base, 'Chromium/Application/chrome.exe'));
    }
  } else {
    for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      candidates.push(...fromPath(command));
    }
  }

  for (const candidate of candidates) {
    if (candidate && await executable(candidate)) return path.resolve(candidate);
  }

  const platformHint = process.platform === 'darwin'
    ? 'Install Google Chrome or Chromium.'
    : process.platform === 'win32'
      ? 'Install Google Chrome or set CHROME_PATH to chrome.exe.'
      : 'Install Google Chrome or Chromium and ensure its executable is on PATH.';
  throw new Error(`Could not find Chrome or Chromium. ${platformHint} Set CHROME_PATH to override discovery.`);
}
