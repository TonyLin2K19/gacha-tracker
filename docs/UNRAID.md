# 用發布的 Docker 映像更新 Unraid

預定 GitHub 倉庫：`TonyLin2K19/gacha-tracker`。GitHub Actions 在 main 推送通過建置與測試後，發布 `ghcr.io/tonylin2k19/gacha-tracker:latest`。版本標籤如 `v0.2.2` 發布 `:0.2.2`，各次發布另有 `:sha-<commit>` 供回退。

## 首次發布

建立空 GitHub repo，推送本機原始碼，等待 Actions 成功。第一次發布後，進 GitHub 的 Packages → gacha-tracker → Package settings，將映像的 visibility 設為 Public，Unraid 才能不登入 registry 下載。此設定與程式倉庫的公開／私有設定分開。

## 第一次改成 Unraid 原生容器管理

在 Docker 頁面建立容器，設定如下；也可由 Unraid XML 範本預填。此方式不需要 Compose。

| 設定                       | 值                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Name                       | gacha-tracker                                                                             |
| Repository                 | ghcr.io/tonylin2k19/gacha-tracker:latest                                                  |
| Network                    | bridge                                                                                    |
| Host port / Container port | 3080 / 3000（TCP）                                                                        |
| Host path / Container path | 現有的資料目錄 / `/data`（讀寫）                                                          |
| DATA_DIR                   | /data                                                                                     |
| TZ                         | Asia/Taipei                                                                               |
| Extra Parameters           | --user 99:100 --init --restart unless-stopped --log-opt max-size=10m --log-opt max-file=3 |
| WebUI                      | http://[IP]:[PORT:3000]                                                                   |

沿用原容器實際掛載到 `/data` 的主機資料目錄；本機 compose 範例為 `/mnt/user/appdata/gacha-tracker`。這是資料庫目錄，不是上傳 ZIP 的程式原始碼目錄。若原本使用 Compose Manager，先停止其舊容器，再改由 Unraid 原生範本管理；同名容器與相同 port 只能啟動一份。保留 appdata 內容。

## 後續更新

程式推送至 main → GitHub Actions 通過驗證並發布 latest → 在 Unraid Docker 頁面檢查更新並更新 gacha-tracker。資料庫與遊戲圖示持續使用原 `/data` 掛載。

## 不上傳的檔案

Git 與 Docker 建置內容排除備份 JSON、SQLite 檔、資料目錄、環境設定、測試副本、ZIP 與介面截圖。GitHub Actions 使用自動提供的 GITHUB_TOKEN 發布，不需要將個人 Token 寫進程式。
