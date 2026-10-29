# 課堂即時問答 Tomcat 部署說明

這是課堂即時問答的 Tomcat 版。功能和畫面都和電腦版相同：投影出題、手機掃碼作答、每題排行榜、頒獎台、網頁編輯題目並自動儲存。

部署到伺服器之後，主持人不用在自己電腦上裝任何東西，打開網址就能主持；同事也可以用同一個網址當主持人。

---

## 一、先確認 Tomcat 版本，選對 WAR

| 你的 Tomcat | Java | 使用的檔案 |
| --- | --- | --- |
| **Tomcat 10 或 11** | Java 11 以上 | `quiz.war` |
| **Tomcat 8.5 或 9** | Java 8 以上 | `tomcat9/quiz.war` |

**怎麼看版本**：任選一種

- 打開 `http://伺服器:8080/`，Tomcat 首頁最上方會寫版本。
- 看 `logs/catalina.xxxx-xx-xx.log` 開頭的 `Server version name`。
- 在 Tomcat 的 `bin` 資料夾執行 `version.bat`（Windows）或 `version.sh`（Linux）。

> 版本選錯的話，網頁會打不開（404），`catalina` 日誌會出現找不到 `javax` 或 `jakarta` 類別的錯誤。換另一個 WAR 就好。

---

## 二、部署

1. 把選好的 **`quiz.war`** 複製到 Tomcat 的 **`webapps`** 資料夾。
   - Tomcat 有開自動部署（預設有）的話，幾秒內就會自動展開成 `webapps/quiz` 資料夾，不用重開 Tomcat。
   - 也可以用 Tomcat Manager 的「WAR file to deploy」上傳。
2. 打開主持頁：**`http://伺服器IP或網域:8080/quiz/host`**
3. 輸入主持密碼，預設是 **1234**。
4. 學員的作答網址是 `http://伺服器:8080/quiz/`，主持頁會自動產生這個網址的 QR Code。

**請用伺服器的 IP 或網域打開主持頁**，不要用 `localhost`，這樣 QR Code 才會是學員手機連得到的網址。

---

## 三、密碼與題庫存在哪裡

第一次部署時，程式會在 **Tomcat 資料夾裡建立 `quiz-data/quiz/`**，放兩個檔案：

| 檔案 | 用途 |
| --- | --- |
| `quiz.properties` | 主持密碼（`hostPin`）和人數上限（`maxPlayers`，預設 50） |
| `questions.json` | 題庫。主持頁「題目編輯」的修改會自動存到這裡 |

- 這個資料夾**在 `webapps` 外面**，所以重新部署或更新 WAR，密碼和題目都不會被覆蓋。
- **改密碼**：用記事本打開 `quiz.properties`，修改 `hostPin=1234` 後存檔。不用重開 Tomcat，下次登入主持頁就生效。
- **備份題目**：複製一份 `questions.json` 即可。
- **想放在別的位置**：在 Tomcat 的 `bin/setenv.bat`（Windows）加上 `set "CATALINA_OPTS=%CATALINA_OPTS% -Dquiz.data.dir=D:\quiz-data"`，或在 `bin/setenv.sh`（Linux）加上 `CATALINA_OPTS="$CATALINA_OPTS -Dquiz.data.dir=/opt/quiz-data"`，然後重開 Tomcat。

日誌裡搜尋「課堂即時問答」，可以看到實際的資料夾位置。

---

## 四、網路與防火牆

- 伺服器的 **8080 埠**（或你們 Tomcat 用的埠）要對學員開放。
- 學員的手機要連得到伺服器：
  - 伺服器只在**院內／公司內網**：學員手機要連內部 Wi-Fi 才能作答，用 4G/5G 連不進來。
  - 伺服器有**對外的網址**：任何網路都能作答。
- 上課前請用一支手機實際掃碼測試一次。

---

## 五、前面有 Apache、nginx 或 IIS 的話

這個工具用 **WebSocket** 即時同步，前面的反向代理必須允許 WebSocket，否則手機會一直停在「連線中…」。

> **注意**：如果是用 **mod_jk（AJP）** 連 Tomcat，AJP 不支援 WebSocket。請把 `/quiz/` 改用 HTTP 代理。

**Apache httpd**（需啟用 `mod_proxy`、`mod_proxy_http`、`mod_proxy_wstunnel`；2.4.47 以上可直接用 `upgrade=websocket`）

```
ProxyPass        /quiz/ http://127.0.0.1:8080/quiz/ upgrade=websocket
ProxyPassReverse /quiz/ http://127.0.0.1:8080/quiz/
```

**nginx**

```
location /quiz/ {
    proxy_pass http://127.0.0.1:8080/quiz/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

**IIS**：在「Windows 功能」開啟「WebSocket 通訊協定」，ARR（Application Request Routing）反向代理就會自動轉送 WebSocket。

網站是 HTTPS 的話，程式會自動改用加密連線（wss），不用另外設定。

---

## 六、上課流程

1. 投影 `http://伺服器:8080/quiz/host`，登入後畫面會顯示大大的 QR Code。
2. 學員掃碼、輸入暱稱加入。
3. 用滑鼠點「**開始第 1 題**」。開始後按**空白鍵**前進：公布答案 → 排行榜 → 下一題。
4. 所有人答完或時間到，會自動公布答案。
5. 最後一題後按「看最終結果」，顯示 🥇🥈🥉 頒獎台與完整排名。
6. 不小心開始了，可以按「↩ 回到大廳」，學員保留、分數歸零。

**分上下半場**：上半場最後一題的排行榜出現後先停著，休息完按「下一題」繼續，分數會累計。

---

## 七、分享給同事

- 把主持頁網址 `http://伺服器:8080/quiz/host` 和主持密碼給同事，他就能當主持人。
- **同一個 WAR 同一時間只有一場測驗**，所有主持人看到的是同一場。如果同事要在同一時段各自上課，可以複製一份 WAR 改名（例如 `quiz2.war`）再放進 `webapps`：
  - 網址會變成 `http://伺服器:8080/quiz2/host`
  - 題庫和密碼會另外放在 `quiz-data/quiz2/`，彼此互不影響。

---

## 八、編輯題目

主持頁上方點「**題目編輯**」：

- 左側題目清單顯示共幾題、幾題未完成，點一下就跳到那一題。綠點是可出題，紅點是還沒填完整。
- 停止打字約 1 秒就會自動儲存。右下角浮動按鈕顯示 🟠「尚未儲存」或 🟢「已儲存」，也可以直接點它立刻存。
- 點選項左邊的色塊（A–D）設定正確答案；C、D 留空就是二選一題。
- 「放棄修改」會還原成這次打開主持頁時的題目。
- 測驗進行中的修改會先保留，回到大廳後自動儲存。

---

## 九、常見問題

| 狀況 | 解決方式 |
| --- | --- |
| 網頁 404 | WAR 版本選錯，或還沒展開完成。看 `logs/catalina.*.log` 的錯誤訊息 |
| 手機一直顯示「連線中…」 | 前面的代理伺服器擋了 WebSocket，看「五」；或防火牆沒開 |
| QR Code 的網址是 `localhost` 開頭 | 主持頁請用伺服器 IP 或網域打開 |
| 忘記主持密碼 | 看 `quiz-data/quiz/quiz.properties` 的 `hostPin` |
| 學員說畫面卡住 | 請他重新整理網頁，會回到目前題目，分數保留 |
| 有人取了不適當的暱稱 | 在大廳點名字旁的「×」移出 |
| 重開 Tomcat 或重新部署 | 題目和密碼保留，但進行中的學員和分數會清空 |

---

## 十、原始碼（給要修改程式的人）

`source/` 資料夾是完整原始碼：

- `src/tw/quiz/`：Java 伺服器（WebSocket 端點、遊戲邏輯、設定讀取），以 `javax` 撰寫，建置時自動轉成 `jakarta` 版。
- `webapp/`：前端頁面（HTML、CSS、JavaScript）。
- `build.sh`：同時建置兩個 WAR。需要 JDK 11 以上，以及 Tomcat 的 `servlet-api.jar`、`websocket-api.jar`（Tomcat 10 另需 `websocket-client-api.jar`）。可以直接指向 Tomcat 的 `lib` 資料夾：

```
T9_LIB=/path/to/tomcat9/lib T10_LIB=/path/to/tomcat10/lib ./build.sh
```

使用的第三方元件：Gson（Apache License 2.0）、qrcode-generator（MIT License）。
