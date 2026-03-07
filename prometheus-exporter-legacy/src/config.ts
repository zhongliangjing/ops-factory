import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

export interface ExporterConfig {
  port: number
  gatewayUrl: string
  gatewaySecretKey: string
  collectTimeoutMs: number
}

interface ConfigYaml {
  port?: number
  gatewayUrl?: string
  gatewaySecretKey?: string
  collectTimeoutMs?: number
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function loadYaml(): ConfigYaml {
  // CONFIG_PATH is the only env var read — a bootstrap mechanism to locate the config file.
  const configPath = process.env.CONFIG_PATH || resolve(__dirname, '..', 'config.yaml')
  if (!existsSync(configPath)) return {}
  return (parse(readFileSync(configPath, 'utf-8')) as ConfigYaml) || {}
}

export function loadConfig(): ExporterConfig {
  const yaml = loadYaml()

  const gatewayUrl = yaml.gatewayUrl
  if (!gatewayUrl) {
    throw new Error('Missing required config: set "gatewayUrl" in prometheus-exporter/config.yaml')
  }

  const gatewaySecretKey = yaml.gatewaySecretKey
  if (!gatewaySecretKey) {
    throw new Error('Missing required config: set "gatewaySecretKey" in prometheus-exporter/config.yaml')
  }

  return {
    port: yaml.port ?? 9091,
    gatewayUrl: gatewayUrl.replace(/\/$/, ''),
    gatewaySecretKey,
    collectTimeoutMs: yaml.collectTimeoutMs ?? 5000,
  }
}
