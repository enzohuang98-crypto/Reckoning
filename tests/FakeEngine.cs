// 假引擎（測試用）：模擬 UCI / UCCI 象棋引擎的 stdin/stdout 行為。
// 以環境變數 FAKE_ENGINE_MODE 切換模式：
//   uci         — 標準 UCI 引擎（Pikafish 行為）
//   ucci        — 標準 UCCI 引擎；收到未知指令（uci）時忽略
//   ucci-strict — UCCI 引擎；收到 uci 直接退出（測試 adapter 的重啟換協定路徑）
//   mate        — UCI 引擎；go 後回 bestmove (none)（測試無合法著法處理）
// 編譯：csc /nologo /out:fake-engine.exe FakeEngine.cs
using System;

class FakeEngine
{
    static void Main()
    {
        string mode = Environment.GetEnvironmentVariable("FAKE_ENGINE_MODE") ?? "uci";
        bool isUcci = false;
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            line = line.Trim();
            if (line == "uci")
            {
                if (mode == "ucci-strict") return; // 收到未知指令就退出的引擎
                if (mode == "uci" || mode == "mate")
                {
                    Console.WriteLine("id name FakeUCI 1.0");
                    Console.WriteLine("option name MultiPV type spin default 1 min 1 max 128");
                    Console.WriteLine("uciok");
                    Console.Out.Flush();
                }
                // mode == "ucci"：忽略未知指令，等 2 秒偵測逾時後 adapter 改送 ucci
            }
            else if (line == "ucci")
            {
                if (mode == "ucci" || mode == "ucci-strict")
                {
                    isUcci = true;
                    Console.WriteLine("id name FakeUCCI 2.0");
                    Console.WriteLine("ucciok");
                    Console.Out.Flush();
                }
            }
            else if (line == "isready")
            {
                Console.WriteLine("readyok");
                Console.Out.Flush();
            }
            else if (line.StartsWith("go"))
            {
                if (mode == "mate")
                {
                    Console.WriteLine("info depth 0 score mate 0");
                    Console.WriteLine("bestmove (none)");
                }
                else if (isUcci)
                {
                    // UCCI：score 為裸數值、無 multipv 欄位
                    Console.WriteLine("info depth 8 score 33 pv b2e2 h9g7");
                    Console.WriteLine("bestmove b2e2");
                }
                else
                {
                    Console.WriteLine("info depth 10 multipv 1 score cp 42 pv h2e2 h9g7");
                    Console.WriteLine("info depth 10 multipv 2 score cp 15 pv b2e2 b9c7");
                    Console.WriteLine("bestmove h2e2");
                }
                Console.Out.Flush();
            }
            else if (line == "quit")
            {
                if (isUcci) Console.WriteLine("bye");
                return;
            }
        }
    }
}
