表情删除后复活问题：本地修复说明

修复内容
1. IndexedDB 中已存在的 myStickerLibrary 数组成为唯一权威上传列表；即使该数组为空，也不会再把全局变量、旧运行时池或退役分组的数据合并回来。
2. 只有 canonical key 不存在时才执行旧数据迁移。迁移完成并写入 canonical key 后，旧数据不再参与每次启动的恢复合并。
3. 主程序 saveData 保存 myStickerLibrary 时，优先从共享表情控制器读取权威上传列表，不再直接使用可能过期的词法变量。
4. canonical 上传键写入经过串行队列处理；过期的普通保存不能把旧列表覆盖回去，且队列中的旧会话写入不会污染新会话。
5. 新增 tests/sticker-deletion-regression.test.js，覆盖 canonical 空列表、旧数据恢复、陈旧自动保存覆盖等回归条件。

本地检查结果
- Node.js 对 index.html 中 67 个可执行内联 JavaScript 脚本进行语法检查：通过。
- sticker-core.js 语法检查：通过。
- 回归测试：5/5 通过。

验证边界
- 当前环境中的 Chromium 浏览器导航被运行环境策略拦截，无法在此环境完成真实浏览器 UI/IndexedDB 的端到端测试。
- 当前环境未配置 Android SDK，因此本地未编译 APK。此压缩包是包含网页版源码、Android 工程和回归测试的完整源码包，不是可直接安装的 APK。
- 真机验收仍需在网页版与两个 App 上分别执行：删除单张、批量删除、清空、等待自动保存、刷新/重启，并确认已删除表情没有重新出现。
