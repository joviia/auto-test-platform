import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { runsRoot } from './paths'

const SCHEME = 'atp-evidence'

/** 必须在 app ready 之前调用 */
export function registerEvidenceSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/** atp-evidence://<runId>/<file> → <userData>/runs/<runId>/<file> */
export function registerEvidenceProtocolHandler(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    const runId = url.hostname
    const filePath = decodeURIComponent(url.pathname).replace(/^\//, '')
    if (!runId || filePath.includes('..')) {
      return new Response('bad request', { status: 400 })
    }
    return net.fetch(pathToFileURL(join(runsRoot(), runId, filePath)).href)
  })
}
