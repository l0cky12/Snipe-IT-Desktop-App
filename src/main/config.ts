import { readFileSync } from 'node:fs'
import type { Config } from './snipeit'

/** Reads and validates config.json. Throws an Error whose message names exactly what's wrong. */
export function readConfig(path: string): Config {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`No config file found at ${path}. Copy config.example.json to config.json and fill in your Snipe-IT URL and personal API key.`)
  }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`config.json is not valid JSON: ${(e as Error).message}`)
  }
  for (const field of ['baseUrl', 'apiKey']) {
    if (typeof json?.[field] !== 'string' || !(json[field] as string).trim())
      throw new Error(`config.json is missing "${field}".`)
  }
  const baseUrl = (json.baseUrl as string).trim()
  if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol))
    throw new Error(`config.json "baseUrl" is not a valid http(s) URL: ${baseUrl}`)
  return { baseUrl, apiKey: (json.apiKey as string).trim() }
}
