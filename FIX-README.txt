v3.8 暗夜模式尾巴颜色修复

基准：v3.7，其余功能保持不变。

本次只处理 5 个“一起听 / iMessage”内置主题的暗夜模式尾巴：
- 日间模式继续使用每套主题原来的 PNG/SVG 尾巴，不改形状、尺寸、位置和素材。
- 暗夜模式使用同一张原尾巴素材作为 alpha mask，只把颜色改为当前气泡的 --xs-theme-sent-bg / --xs-theme-received-bg。
- mask 使用 center/cover/no-repeat，与原主题 background-size: cover 保持一致；不再使用 v3.7 的统一 clip-path。
- 未修改聊天保存、表情加载、滚动、主动发表情等其他逻辑。
