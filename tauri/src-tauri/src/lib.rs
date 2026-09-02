// GoFundBot Tauri 2 shell — 仅解禁浏览器 CORS 限制的壳。
//
// 它不打包前端资源：WebView 加载的是「正在运行的前端服务」origin
// （dev: http://localhost:8517, prod: http://localhost:8417 静态托管）。
// 出站 HTTP 使用 tauri-plugin-http（原生，绕过 CORS）——市场数据直连
// Node (localhost:8310)，AI / 搜索直连外部 API。
//
// 文档入口（各页面「?」）为纯前端实现：主窗口内嵌 iframe 面板（docsStore +
// DocsViewer.vue），不再创建第二 WebView 窗口，故本壳无相关命令。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
