- [x] 1. 清理 `frontend/src/App.jsx` 的 heredoc 殘留內容
- [x] 2. 新增 `frontend/src/index.css` 以符合 `main.jsx` 匯入
- [x] 3. 執行前端 build 驗證修正結果

註記：本機 PowerShell 找不到 `npm`，改用 Docker 驗證時又卡在既有的 build context 問題（`node_modules/.bin/baseline-browser-mapping`），需先處理 docker build context 設定後再完成此步。

- [x] 4. 新增 `frontend/.dockerignore` 排除 `node_modules` 避免 build context 錯誤
