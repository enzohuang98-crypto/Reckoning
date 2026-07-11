const STARTUP_FAILURE_HTML = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    >
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>象棋 AI 分析講解 - 啟動失敗</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", "Microsoft JhengHei", sans-serif; }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 32px;
        color: #1f3028;
        background: #f3f6f2;
      }
      main {
        width: min(520px, 100%);
        padding: 36px;
        border: 1px solid #d9e2dc;
        border-radius: 20px;
        background: #fff;
        box-shadow: 0 18px 48px rgba(31, 48, 40, 0.12);
      }
      .mark {
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        margin-bottom: 20px;
        border-radius: 14px;
        color: #fff;
        background: #9d3c32;
        font-size: 24px;
        font-weight: 700;
      }
      h1 { margin: 0 0 12px; font-size: 26px; }
      p { margin: 0; color: #5f6f66; line-height: 1.7; }
      p + p { margin-top: 10px; }
    </style>
  </head>
  <body>
    <main role="alert">
      <div class="mark" aria-hidden="true">象</div>
      <h1>應用程式無法完成啟動</h1>
      <p>介面檔案載入失敗，系統已停止繼續等待，因此不會停留在空白畫面。</p>
      <p>請完整關閉應用程式後重新開啟；若問題持續，請重新安裝最新版。</p>
    </main>
  </body>
</html>`

export function startupFailurePageUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(STARTUP_FAILURE_HTML)}`
}
