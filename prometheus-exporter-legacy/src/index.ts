import http from 'node:http'
import { loadConfig } from './config.js'
import { Collector } from './collector.js'

const config = loadConfig()
const collector = new Collector(config)

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (url.pathname === '/metrics' && req.method === 'GET') {
    try {
      await collector.collect()
      const metrics = await collector.registry.metrics()
      res.writeHead(200, { 'Content-Type': collector.registry.contentType })
      res.end(metrics)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end(`Error collecting metrics: ${err instanceof Error ? err.message : String(err)}\n`)
    }
    return
  }

  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<html><body><h1>Ops Factory Prometheus Exporter</h1><p><a href="/metrics">Metrics</a></p></body></html>`)
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found\n')
})

server.listen(config.port, () => {
  console.log(`Ops Factory Prometheus Exporter listening on :${config.port}`)
  console.log(`  Gateway: ${config.gatewayUrl}`)
  console.log(`  Metrics: http://127.0.0.1:${config.port}/metrics`)
})
