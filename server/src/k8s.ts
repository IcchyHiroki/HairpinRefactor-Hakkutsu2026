import * as https from 'https'
import * as fs from 'fs'

const SA_TOKEN = '/var/run/secrets/kubernetes.io/serviceaccount/token'
const SA_CA = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
const API_SERVER = 'https://kubernetes.default.svc'
const NAMESPACE = 'default'
const GSS_LABEL = 'game.example.com/gameserverset-name'
const POD_INDEX_LABEL = 'game.example.com/pod-index'
const GSS_NAME = 'hairpin-game'

let auth: { token: string; ca: string } | null = null

function getAuth(): { token: string; ca: string } | null {
  if (auth) return auth
  try {
    auth = { token: fs.readFileSync(SA_TOKEN, 'utf8').trim(), ca: fs.readFileSync(SA_CA, 'utf8') }
    return auth
  } catch {
    console.warn('k8s: not running in-cluster, fallback to in-memory')
    return null
  }
}

function k8sGet<T>(path: string): Promise<T | null> {
  return new Promise(resolve => {
    const a = getAuth()
    if (!a) return resolve(null)
    const req = https.get(`${API_SERVER}${path}`, {
      headers: { Authorization: `Bearer ${a.token}`, Accept: 'application/json' },
      ca: a.ca,
    }, res => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}

function k8sDelete(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const a = getAuth()
    if (!a) return resolve(false)
    const u = new URL(`${API_SERVER}${path}`)
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      ca: a.ca,
    }, res => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => resolve(res.statusCode === 200))
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

export async function deleteGamePod(index: number): Promise<void> {
  const sel = encodeURIComponent(`${GSS_LABEL}=${GSS_NAME},${POD_INDEX_LABEL}=${index}`)
  const list = await k8sGet<any>(`/api/v1/namespaces/${NAMESPACE}/pods?labelSelector=${sel}`)
  const podName = list?.items?.[0]?.metadata?.name
  if (!podName) return
  const ok = await k8sDelete(`/api/v1/namespaces/${NAMESPACE}/pods/${podName}`)
  console.log(`k8s: delete ${podName} (index=${index}) ${ok ? 'OK' : 'FAIL'}`)
}

export async function checkPodStatuses(destinationIds: number[]) {
  const sel = encodeURIComponent(`${GSS_LABEL}=${GSS_NAME}`)
  const list = await k8sGet<any>(`/api/v1/namespaces/${NAMESPACE}/pods?labelSelector=${sel}`)
  if (!list?.items) return destinationIds.map(id => ({ id, alive: true }))

  const aliveIndices = new Set<number>()
  for (const pod of list.items) {
    if (pod.metadata?.deletionTimestamp) continue
    const idx = pod.metadata?.labels?.[POD_INDEX_LABEL]
    if (idx !== undefined) aliveIndices.add(Number(idx))
  }
  return destinationIds.map(id => ({ id, alive: aliveIndices.has(id - 1) }))
}
