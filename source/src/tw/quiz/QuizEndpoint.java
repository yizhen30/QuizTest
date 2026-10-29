package tw.quiz;

import javax.websocket.CloseReason;
import javax.websocket.OnClose;
import javax.websocket.OnError;
import javax.websocket.OnMessage;
import javax.websocket.OnOpen;
import javax.websocket.Session;
import javax.websocket.server.ServerEndpoint;

/** 主持人與作答者共用的即時連線：ws(s)://伺服器/應用程式名稱/ws */
@ServerEndpoint("/ws")
public class QuizEndpoint {

    @OnOpen
    public void open(Session s) {
        s.setMaxIdleTimeout(0);
        s.setMaxTextMessageBufferSize(512 * 1024);
        Game.I.opened(s);
    }

    @OnMessage
    public void message(Session s, String text) {
        if (text.startsWith("{\"t\":\"ping\"")) return; // 前端每 25 秒送一次，避免代理伺服器把連線斷掉
        Game.I.onMessage(s, text);
    }

    @OnClose
    public void close(Session s, CloseReason reason) {
        Game.I.closed(s);
    }

    @OnError
    public void error(Session s, Throwable t) {
        // 斷線等錯誤會接著觸發 onClose
    }
}
