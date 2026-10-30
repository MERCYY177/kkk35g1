# 传讯三个独立 Android APK

本项目现有 Android 外壳是原生 Android Gradle + Android WebView，不是 PakePlus/Tauri 工程；本次沿用并修正这套已经存在的构建结构，不臆造 PakePlus 的配置 API。

## 本地资源运行方式

Gradle 的 `stageWebProject` 任务会将项目根目录中的 `index.html`、全部根级 HTML/JS/CSS/JSON 文件以及 `assets/**` 复制进 APK 的 `assets/site/`。`MainActivity` 使用 AndroidX `WebViewAssetLoader` 从 `https://appassets.androidplatform.net/assets/site/index.html` 加载这些 APK 内资源。这个 HTTPS 主机由 WebViewAssetLoader 本地拦截，不会请求 GitHub Pages，也不是远程网页入口。

`WebViewAssetLoader` 提供稳定的 HTTPS same-origin，使 IndexedDB、Blob URL、FontFace、BroadcastChannel 可以使用。朋友圈和 Chat 2 是 `srcdoc` 独立 document；两份嵌入式 HTML 都各自加载 `custom-font-manager.js`，因此在各自的 document 中单独注册 FontFace。

## 三个应用变体

| APK | Gradle flavor | applicationId | 说明 |
|---|---|---|---|
| 传讯1.apk | `chuanxun1` | `com.mercyy.transmission` | 保留现有 standard 应用身份 |
| 传讯2.apk | `chuanxun2` | `com.mercyy.transmission.new` | 保留现有 darkfix 应用身份 |
| 传讯3.apk | `chuanxun3` | `com.mercyy177.chuanxun.three` | 新增独立应用身份 |

第一、第二个 ID 是从原始 `android-apps/app/build.gradle.kts` 检查得到的既有身份，故保留它们以便覆盖安装升级；第三个使用新的唯一 ID。三个 ID 互不相同，可并行安装。每个 APK 均有自己的 Android 应用沙箱、WebView 数据目录、IndexedDB 和字体库。

## 一次构建三个 APK

需要 JDK 17、Android SDK 35、Build Tools 35.0.0 和 Gradle 8.9。项目根目录执行：

```bash
./android-apps/build-three-apks.sh
```

或者在 GitHub Actions 的 `Build three local ChuanXun Android apps` 工作流中手动运行 `workflow_dispatch`。该工作流一次调用三个 Gradle assemble task，校验 applicationId、签名和 APK 中完整资源后上传一个包含三个 APK 的 artifact。

本次交付没有向 GitHub 推送，也没有触发远程 Actions。原 `build-two-apps.yml` 入口文件已保留，但改为调用同一套三 APK 本地构建工作流，不再构建 GitHub Pages 远程网页壳。

## 本地字体

自定义字体由主页面的“设置 → 显示与字体 → 本地自定义字体”入口导入。Android `WebChromeClient.onShowFileChooser` 打开系统文件选择器；字体二进制 Blob 与文件名、格式、ID、当前启用 ID 一起写入当前应用的 IndexedDB。支持 TTF、OTF、WOFF、WOFF2。先检查魔数和真实 FontFace 加载结果，再持久化替换，损坏字体不会替换当前字体。

每份 document 都从同一 app origin 的 IndexedDB 读取字体并在自己的 `document.fonts` 中注册；BroadcastChannel 和 storage event 用于同步切换、删除和恢复默认字体。字体不复制到另外两个 APK，也不依赖网络。打包版会跳过旧 `settings.customFontUrl` 的远程字体加载，Web 网页版仍保留原 `applyCustomFont(url)` 兼容路径。

## 数据兼容提示

原 Android 壳原先使用 `file:///android_asset/site/index.html`，新壳改用官方推荐的 WebViewAssetLoader HTTPS 本地 origin，以使 IndexedDB 和 same-origin iframe 稳定工作。不同 origin 的 WebView localStorage/IndexedDB 不会自动互通。本地构建无法访问用户设备上的旧 WebView 数据，故不能声称已完成旧 file-origin 聊天数据库迁移。若你已有旧 APK 且其中存有重要聊天记录，升级前应先在旧版本导出应用数据备份；在真实设备验证旧数据迁移前，不应卸载旧版或清除其数据。新版本的 Chat 1、Chat 2 和朋友圈继续保留原有数据键和存储结构。

## 已知的离线边界

项目已有若干可选气泡皮肤预设，其装饰图像以第三方 URL 写在预设 CSS 字符串中；Kakao 音效预设也引用一条第三方 MP3 URL。这些素材没有随原始项目 ZIP 提供，当前执行环境无法解析这些第三方域名，因此不能声称已经把这些特定装饰图/音效本体封装进 APK。项目内已有的 378 个内置表情文件和 18 个内置主题资源会完整复制进每个 APK；普通聊天、朋友圈和 Chat 2 的本地页面资源不依赖远程首页。选择上述第三方素材预设时，离线状态下装饰图或音效可能不可用。

## 设备验证尚未完成

当前修改容器没有 Android SDK/Build Tools、Gradle、ADB 或实体华为设备，故尚不能实际生成/安装 APK，也无法在设备上验收文件选择器、IndexedDB 重启恢复、字体更换后的三个 document 同步及离线渲染。新增的 APK 包体核验脚本会在真正构建时检查每个 APK 中的项目入口、核心 JS、表情资源数量、内置主题数量和删除保护代码。
