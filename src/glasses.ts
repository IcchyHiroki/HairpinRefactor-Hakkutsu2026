import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

export const bridge = await waitForEvenAppBridge()

const LIST_ID = 1
const TEXT_ID = 2

// 左：タイル（選択リスト）／右：詳細テキスト
export function buildPage(titles: string[], detail: string) {
  const list = new ListContainerProperty({
    containerID: LIST_ID, containerName: 'tiles',
    xPosition: 0, yPosition: 0, width: 330, height: 288,
    borderWidth: 1, borderColor: 8, borderRadius: 4, paddingLength: 6,
    itemContainer: new ListItemContainerProperty({
      itemCount: titles.length,
      itemWidth: 0,              // 0 = auto
      isItemSelectBorderEn: 1,   // 選択枠を出す＝タイル感
      itemName: titles,
    }),
    isEventCapture: 1,           // ★入力はこのコンテナで受ける
  })
  const text = new TextContainerProperty({
    containerID: TEXT_ID, containerName: 'detail',
    xPosition: 340, yPosition: 0, width: 236, height: 288,
    borderWidth: 1, borderColor: 4, borderRadius: 4, paddingLength: 8,
    content: detail,
    isEventCapture: 0,
  })
  return { list, text }
}

export async function showStartup(titles: string[], detail: string) {
  const { list, text } = buildPage(titles, detail)
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 2, listObject: [list], textObject: [text], imageObject: [],
    })
  )
}

export async function rebuildPage(titles: string[], detail: string) {
  const { list, text } = buildPage(titles, detail)
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 2, listObject: [list], textObject: [text], imageObject: [],
    })
  )
}

// 詳細だけ差し替え（ちらつき無し）
export async function updateDetail(content: string) {
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: TEXT_ID, content }))
}

// リスト選択イベントを購読
export function onListSelect(
  callback: (index: number) => void,
  getCount: () => number,
  onRawEvent?: (raw: string) => void,
): () => void {
  let currentIdx = 0
  return bridge.onEvenHubEvent((event) => {
    onRawEvent?.(JSON.stringify(event.jsonData ?? event))

    const isListEvent = event.listEvent != null
      || event.jsonData?.containerID === LIST_ID
      || event.jsonData?.containerName === 'tiles'

    const idx = event.listEvent?.currentSelectItemIndex
      ?? (typeof event.jsonData?.currentSelectItemIndex === 'number' ? event.jsonData.currentSelectItemIndex : null)
      ?? (isListEvent ? 0 : null)

    if (idx != null) {
      currentIdx = idx
      callback(currentIdx)
      return
    }

    const eventType = event.listEvent?.eventType
    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      currentIdx = Math.min(currentIdx + 1, getCount() - 1)
      callback(currentIdx)
    } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      currentIdx = Math.max(currentIdx - 1, 0)
      callback(currentIdx)
    }
  })
}