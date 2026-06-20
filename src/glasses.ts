import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerProperty,
  TextContainerUpgrade,
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

// 詳細だけ差し替え（ちらつき無し）
export async function updateDetail(content: string) {
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: TEXT_ID, content }))
}