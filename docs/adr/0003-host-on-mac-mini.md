# 部署在家中的 Mac mini（FileVault 關閉、開啟自動登入）

部署主機從 GCloud VM 搬到家中的 Mac mini（Apple Silicon、macOS 26）。GCloud 上的資料不搬移，正式環境從空 DB 開始。gunicorn 由 LaunchDaemon 常駐執行，只綁 `127.0.0.1:8000`，外部只能經由 Funnel 連進來。

主要的要求是**斷電或當機重開之後，不需要有人在場也能恢復服務**，因為最常使用的時候正是人在國外的時候。

- **FileVault 關閉**：開著 FileVault 的 Apple Silicon Mac 重開後會停在解鎖畫面。在解鎖之前連 LaunchDaemon 都不會啟動，不只是 Tailscale 的問題。
- **開啟 macOS 自動登入，並繼續使用 standalone 版 Tailscale**（`io.tailscale.ipn.macsys`）。standalone 版要等使用者登入後才會啟動，但有自動登入就不受影響，所以不必改用 Homebrew 的 `tailscaled` system daemon。換掉的話會變成新的 Tailscale 節點，還會連帶影響 `investment_dashboard`。

## Consequences

- 刻意接受的實體風險：磁碟沒有加密，而且重開機後會直接進入已解鎖的桌面。能碰到這台機器的人可以讀取 DB、收據照片和 `.env`。這台放在家中，因此決定不另外設定登入後立即鎖定螢幕。
- 刻意不做外部可用性監控。收據照片會留在手機裡，服務停擺只是延後上傳，不會遺失資料。
- 同一台機器同時也是開發機，因此需要分離開發環境與正式環境（見 ADR-0004）。
