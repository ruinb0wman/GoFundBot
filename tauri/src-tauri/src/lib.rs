// GoFundBot Tauri 2 shell — 仅解禁浏览器 CORS 限制的壳。
//
// 它不打包前端资源：WebView 加载的是「正在运行的前端服务」origin
// （dev: http://localhost:5173, prod: http://localhost:4173 静态托管）。
// 出站 HTTP 使用 tauri-plugin-http（原生，绕过 CORS）——市场数据直连
// Node (localhost:3100)，AI / 搜索直连外部 API。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}