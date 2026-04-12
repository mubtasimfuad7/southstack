
import { runtimeService } from '../src/core/services/RuntimeService';

async function debug() {
  try {
    const { stdout } = await runtimeService.executeCommand('echo $PATH');
    console.log('PATH:', stdout);
    
    const { stdout: lsOut } = await runtimeService.executeCommand('ls -R /usr/local/bin');
    console.log('LS /usr/local/bin:', lsOut);
  } catch (err) {
    console.error(err);
  }
}

debug();
