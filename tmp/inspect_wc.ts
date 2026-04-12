
import { runtimeService } from '../src/core/services/RuntimeService';

async function debug() {
  console.log('--- WC Debug Start ---');
  try {
    const { stdout: pwd } = await runtimeService.executeCommand('pwd');
    console.log('PWD:', pwd.trim());

    const { stdout: path } = await runtimeService.executeCommand('echo $PATH');
    console.log('PATH (env):', path.trim());

    const { stdout: lsBin } = await runtimeService.executeCommand('ls -la /.bin');
    console.log('LS /.bin:', lsBin);

    const { stdout: lsUsr } = await runtimeService.executeCommand('ls -la /usr/local/bin');
    console.log('LS /usr/local/bin:', lsUsr);

    const { stdout: nodePath } = await runtimeService.executeCommand('which node');
    console.log('Which node:', nodePath.trim());

  } catch (err) {
    console.error('Debug failed:', err);
  }
  console.log('--- WC Debug End ---');
}

debug();
