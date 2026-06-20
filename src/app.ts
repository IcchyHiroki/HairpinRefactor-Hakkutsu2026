import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { bridge, showStartup, updateDetail } from './glasses'
import { startRecording, stopAndTranscribe, handleAudioEvent } from './stt'

type Step = { title: string; detail: string }

const STEPS: Step[] = [
  { title: '① 入口の鳥居', detail: '正面の鳥居は江戸期の再建。\n左の石灯籠に注目。' },
  { title: '② 拝殿の彫刻', detail: '欄間の龍は地元宮大工の作。\nタップで音声解説。' },
  { title: '③ 御神木',     detail: '樹齢約400年のクスノキ。\n落雷跡が残る。' },
  { title: '🎤 音声で質問', detail: 'ダブルタップで録音開始。' },
]

const VOICE_STEP = 3

let selected = 0
let isRecording = false

async function toggleRecording() {
  if (!isRecording) {
    isRecording = true
    await updateDetail('🔴 録音中...\nダブルタップで停止。')
    await startRecording((bytes) => {
      const kb = (bytes / 1024).toFixed(1)
      void updateDetail(`🔴 録音中... ${kb} KB`)
    })
  } else {
    isRecording = false
    await updateDetail('⏳ 文字起こし中...')
    const text = await stopAndTranscribe()
    await updateDetail(text || '（認識できませんでした）')
  }
}

export async function start() {
  await showStartup(STEPS.map(s => s.title), STEPS[selected].detail)

  bridge.onEvenHubEvent((event) => {
    // リスト選択移動
    if (event.listEvent && typeof event.listEvent.currentSelectItemIndex === 'number') {
      selected = event.listEvent.currentSelectItemIndex
      if (!isRecording) void updateDetail(STEPS[selected].detail)
    }

    // ダブルタップで音声ステップの録音トグル
    if (
      event.listEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT &&
      selected === VOICE_STEP
    ) {
      void toggleRecording()
    }

    // PCM ストリームをバッファに蓄積
    if (event.audioEvent) {
      handleAudioEvent(event.audioEvent.audioPcm)
    }
  })
}
