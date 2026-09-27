kkk35g1 v3.9 — 聊天记录保存误报修复

基准：v3.8 暗夜尾巴颜色修复版。
本版只调整聊天记录保存链，不改 CSS / 气泡 / 尾巴 / 表情加载 / 滚动 / 主动表情逻辑。

修复：
1. chatMessages 先独立写入 IndexedDB；表情资源映射 flush 失败不再把聊天记录误判为保存失败。
2. 只有真正的 chatMessages IndexedDB 写入失败时，才弹“聊天记录保存失败，请先别退出页面”。
3. 去掉发表情时重复的 sticker-send-immediate 第二次聊天保存；addMessage 自己的即时保存队列仍保留。
