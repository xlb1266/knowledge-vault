const { spawn } = require('child_process');

function startProcess(name, cmd, args, cwd) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'pipe',
    shell: true,
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line) console.log(`[${name}] ${line}`);
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      if (line) console.error(`[${name}] ${line}`);
    });
  });

  child.on('close', (code) => {
    console.log(`[${name}] 进程退出，退出码: ${code}`);
  });

  return child;
}

console.log('🚀 启动 Knowledge Vault...\n');

const server = startProcess('server', 'node', ['src/index.js'], __dirname + '/server');
const client = startProcess('client', 'npx', ['vite', '--host'], __dirname + '/client');

process.on('SIGINT', () => {
  console.log('\n⏹️  正在关闭所有服务...');
  server.kill();
  client.kill();
  process.exit(0);
});
