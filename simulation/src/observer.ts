import express from 'express'
import fetch from 'node-fetch'
import { graphviz } from 'node-graphviz'

const workers: string[] = process.env.WORKERS!.split(',').filter((url) => !!url)

function requestInfo() {
  return Promise.all(
    workers.map((url) =>
      fetch(`${url}/info`)
        .then((r) => r.json())
        .catch(() => [])
    )
  )
}

async function start() {
  const app: express.Application = express()

  app.get('/', async (_req, res) => {
    const results = await requestInfo()
    let body = '<ol>'
    for (let i = 0; i < workers.length; i++) {
      const url = workers[i]
      const client = results[i]
      let trace: string
      if (!client.trace) {
        trace = ''
      } else if (client.trace.startsWith(`${client.id}`)) {
        trace = `<li> Trace: ${client.trace} <a href="/view-trace?clientId=${client.id}&traceId=${client.trace}">View trace</a> </li>`
      } else {
        trace = `<li> Trace: ${client.trace} </li>`
      }
      body += `
<li>${client.id} (prefix: ${client.prefix})
  <ul>
    <li>Ping: ${client.ping}</li>
${trace}
    <li>
<a href="${url}/matrix">Adjacency Matrix</a> / 
<a href="/view-graph?clientId=${client.id}&workerIndex=${i}">Graph</a> / 
<a href="${url}/connections">Connections</a> /
<a href="${url}/trace">Send trace</a>
    </li>
  </ul>
</li>
`
    }

    body += '</ol>'
    res.write(`<html><body>${body}</body></html>`)
    res.end()
  })

  app.get('/view-graph', async (req, res) => {
    const workerIndex = parseInt(req.query.workerIndex as string, 10)
    const url = workers[workerIndex]

    const dot = await fetch(`${url}/graph`)

    const graph = await dot.text()
    const svg = await graphviz.circo(graph, 'svg')
    res.setHeader('Content-Type', 'image/svg+xml')
    res.write(svg)
    res.end()
  })

  app.get('/view-trace', async (req, res) => {
    const clientId = req.query['clientId'] as string
    const traceId = req.query['traceId'] as string

    const results = await requestInfo()
    const nodesToPaint: number[] = []
    let viewTraceUrl = ''
    for (let i = 0; i < workers.length; i++) {
      const url = workers[i]
      const client = results[i]

      if (client.id === parseInt(clientId, 10)) {
        viewTraceUrl = `${url}/view-trace`
      }
      if (client.trace === traceId) {
        nodesToPaint.push(client.id)
      }
    }

    const dot = await fetch(viewTraceUrl, {
      body: JSON.stringify({ nodesToPaint: nodesToPaint }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    const graph = await dot.text()
    const svg = await graphviz.circo(graph, 'svg')
    res.setHeader('Content-Type', 'image/svg+xml')
    res.write(svg)
    res.end()
  })

  const port = 8000
  app.listen(port, () => {
    console.log(`API ready in :${port}`)
  })
}

start().catch(console.error)
