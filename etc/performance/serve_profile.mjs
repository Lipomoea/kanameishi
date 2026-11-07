// Exclude local browser profiles and recordings from Vite's filesystem watcher.
import { createServer } from 'vite'
const server = await createServer({ server: { host: '127.0.0.1', watch: { ignored: ['**/etc/performance/**'] } } })
await server.listen()
server.printUrls()
