import '../src/server.js'

// O Windows encerra o processo à força com child.kill(). O IPC deste fixture
// aciona o mesmo handler do serviço e permite observar o encerramento.
process.on('message', (signal) => {
  if (signal !== 'SIGINT' && signal !== 'SIGTERM') return

  process.emit(signal)
  process.send('encerrando', () => process.disconnect())
})
