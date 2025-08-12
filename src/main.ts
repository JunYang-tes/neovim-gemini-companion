import { IDEServer } from './ide-server.js';

async function main() {
  if (!process.env['NVIM_LISTEN_ADDRESS']) {
    console.error('NVIM_LISTEN_ADDRESS environment variable is not set.');
    console.error('This application requires a running Neovim instance.');
    process.exit(1);
  }

  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1], 10) : 0;

  const server = new IDEServer(console.log);
  await server.start(port);
}

main();
