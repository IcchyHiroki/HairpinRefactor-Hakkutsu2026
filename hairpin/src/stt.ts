import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@xenova/transformers'
import { bridge } from './glasses'


let recording = false
const pcmChunks: Uint8Array[] = []
let totalBytes = 0
let whisper: AutomaticSpeechRecognitionPipeline | null = null

// 初回呼び出し時にモデルをダウンロード＆キャッシュ
async function getWhisper(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!whisper) {
    whisper = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny', // 多言語モデル（日本語対応）
    ) as AutomaticSpeechRecognitionPipeline
  }
  return whisper
}

/** 録音開始。onBytes で受信バイト数を通知（進捗表示用）。 */
export async function startRecording(onBytes?: (n: number) => void): Promise<void> {
  pcmChunks.length = 0
  totalBytes = 0
  recording = true
  onBytesCallback = onBytes ?? null
  await bridge.audioControl(true)
}

/** 録音停止 → Whisper 推論 → テキストを返す */
export async function stopAndTranscribe(): Promise<string> {
  recording = false
  await bridge.audioControl(false)

  if (totalBytes === 0) return ''

  const float32 = mergeAndConvert()
  const asr = await getWhisper()
  // Whisper は 16kHz 固定なので sampling_rate 指定不要
  const result = await asr(float32)
  return (result as { text: string }).text.trim()
}

/** onEvenHubEvent ハンドラから呼ぶ */
export function handleAudioEvent(pcm: Uint8Array): void {
  if (!recording) return
  pcmChunks.push(new Uint8Array(pcm)) // コピーして保持
  totalBytes += pcm.length
  onBytesCallback?.(totalBytes)
}

let onBytesCallback: ((n: number) => void) | null = null

// 16bit signed PCM → Float32（Whisper 入力形式）
function mergeAndConvert(): Float32Array {
  const merged = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of pcmChunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  const samples = merged.length / 2
  const float32 = new Float32Array(samples)
  const view = new DataView(merged.buffer)
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768
  }
  return float32
}
