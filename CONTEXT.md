# receipt-system

記錄旅行消費的個人系統：拍下收據，由 AI 解析內容，並依旅程統計花費。

## 記帳

**Trip（旅程）**:
一段有起訖日期、幣別和預算的旅行。統計時只計入日期落在旅程範圍內的收據。
_Avoid_: 行程、旅行、專案

**Receipt（收據）**:
一筆屬於某個 Trip 的消費紀錄，包含原始照片，以及解析出來的店名、日期、金額、付款方式和分類。
_Avoid_: 單據、發票、交易

**Receipt Item（品項）**:
一張 Receipt 上的一行購買明細。
_Avoid_: 商品、明細行

## 環境與維運

**正式環境（Production）**:
透過 Funnel 對外提供服務、存放真實資料的那一份部署。
_Avoid_: 線上、伺服器、VM

**開發環境（Development）**:
開發用的 repo 與它自己的資料，裡面的資料隨時可以丟掉。
_Avoid_: 本機（兩個環境都在同一台 Mac mini 上）

**部署（Deploy）**:
把 GitHub `main` 上的版本套用到正式環境的動作。
_Avoid_: push、上傳（push 到 GitHub 不等於部署）

**回退（Rollback）**:
部署失敗後，手動把正式環境改回之前的 commit，必要時再還原部署前快照。
_Avoid_: 復原、revert

**部署前快照（Pre-deploy Snapshot）**:
每次部署在 migration 前留下的正式 DB 副本，只存在本機，只用於回退該次部署。
_Avoid_: 備份

**每日備份（Daily Backup）**:
每天送到異地保存的正式資料副本，包含 DB 快照與收據照片。
_Avoid_: 同步、快照
