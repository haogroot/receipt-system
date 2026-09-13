# 每日備份到 iCloud Drive

正式資料（DB 與收據照片）原本沒有任何異地備份：GCloud VM 已經不用了，Mac mini 也沒有設定 Time Machine。決定**每天凌晨 3 點由 LaunchAgent 備份到 iCloud Drive**。

- **DB**：用 SQLite backup API 做快照，並對每份快照執行 `PRAGMA integrity_check`。**絕對不直接同步正在使用中的 DB 檔案**，iCloud 同步會讓它損毀。保留最近 14 天的每日快照，另外每月保留一份，保留 12 個月。
- **`uploads/`**：保留原圖，**只新增、不刪除**。在 app 裡刪掉收據、或 app 出 bug 誤刪檔案時，備份裡的照片不會跟著消失。
- **用 LaunchAgent，而不是 LaunchDaemon**：iCloud 同步只在使用者 session 內運作，而且在背景寫入 `~/Library/Mobile Documents` 可能會被 TCC 擋下。有自動登入（見 ADR-0003），所以重開機後照樣會執行。
- **失敗通知**：記錄最後一次成功備份的時間；`deploy.sh` 發現超過 48 小時沒有成功備份時會發出警告。這樣就不需要外部監控服務。

## Considered Options

- **Google Drive**（改寫 `deploy/upload_to_drive.py`）：OAuth refresh token 可能過期，也可能外洩。這個 token 和相關程式已決定刪除。
- **Time Machine 外接硬碟**：硬碟和 Mac mini 放在同一個地方，不算異地備份。

## Consequences

- 需要足夠的 iCloud 容量。照片不壓縮，以每年約 1,000 張收據估算，約需 3 GB。
