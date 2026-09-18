import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import electron from 'electron'
import './build.mjs'

const server = await createServer()
await server.listen()
const environment = { ...process.env, NODUS_DEV: '1' }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.'], { stdio: 'inherit', env: environment })
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0) })
process.on('SIGINT', () => child.kill())
