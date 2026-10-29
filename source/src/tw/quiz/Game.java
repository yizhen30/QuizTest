package tw.quiz;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import javax.websocket.Session;
import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.io.Writer;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

/**
 * 課堂即時問答的遊戲狀態（整個應用程式只有一場）。
 * 所有狀態變更都在 synchronized 方法內進行。
 */
public final class Game {
    public static final Game I = new Game();
    private static final Logger LOG = Logger.getLogger("quiz");

    final Gson gson = new GsonBuilder().disableHtmlEscaping().create();

    // ---------- 設定與題庫 ----------
    private Path dataDir;
    private Path qfile;
    private Path propFile;
    private int maxPlayers = 50;

    static final class Q {
        String text = "";
        List<String> options = new ArrayList<String>();
        int answer;
        int seconds = 20;
        String explanation = "";
    }

    static final class Quiz {
        String title = "課堂小測驗";
        List<Q> questions = new ArrayList<Q>();
    }

    private Quiz quiz = new Quiz();
    private List<Q> play = new ArrayList<Q>();

    // ---------- 遊戲狀態 ----------
    static final class Answer {
        int choice; boolean correct; int points; long ms;
    }

    static final class Player {
        String id, name, sessionId;
        int score, lastPoints;
        Integer prevRank;
        long joinedAt;
        boolean connected;
        Map<Integer, Answer> answers = new HashMap<Integer, Answer>();
    }

    private final LinkedHashMap<String, Player> players = new LinkedHashMap<String, Player>();
    private final Map<String, Session> sessions = new HashMap<String, Session>();
    private final Map<String, Session> hosts = new HashMap<String, Session>();

    private String phase = "lobby";
    private int qIndex = -1;
    private long startedAt, endsAt;
    private int[] counts = new int[4];

    private ScheduledExecutorService exec;
    private ScheduledFuture<?> timer;

    private Game() {}

    // ================= 啟動 / 關閉 =================

    synchronized void init(Path dir, InputStream defaultQuestions) throws IOException {
        dataDir = dir;
        Files.createDirectories(dataDir);
        qfile = dataDir.resolve("questions.json");
        propFile = dataDir.resolve("quiz.properties");
        if (!Files.exists(qfile) && defaultQuestions != null) {
            Files.copy(defaultQuestions, qfile);
        }
        if (!Files.exists(propFile)) {
            String p = "# 課堂即時問答設定（修改後不用重新啟動，下次登入主持頁就會生效）\n"
                    + "# 主持密碼\n"
                    + "hostPin=1234\n"
                    + "# 一場最多幾人\n"
                    + "maxPlayers=50\n";
            Files.write(propFile, p.getBytes(StandardCharsets.UTF_8));
        }
        readProps();
        quiz = loadQuiz();
        play = playableOf(quiz);
        exec = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "quiz-timer");
            t.setDaemon(true);
            return t;
        });
        LOG.info("課堂即時問答已啟動，資料資料夾：" + dataDir.toAbsolutePath());
    }

    synchronized void shutdown() {
        if (exec != null) exec.shutdownNow();
    }

    String dataDirText() { return dataDir == null ? "" : dataDir.toAbsolutePath().toString(); }

    private Properties readProps() {
        Properties p = new Properties();
        try (Reader r = Files.newBufferedReader(propFile, StandardCharsets.UTF_8)) {
            p.load(r);
        } catch (Exception e) {
            LOG.warning("讀取 quiz.properties 失敗：" + e.getMessage());
        }
        try { maxPlayers = Math.max(1, Integer.parseInt(p.getProperty("maxPlayers", "50").trim())); }
        catch (NumberFormatException e) { maxPlayers = 50; }
        return p;
    }

    private String hostPin() {
        String env = System.getenv("QUIZ_HOST_PIN");
        String v = readProps().getProperty("hostPin", "").trim();
        if (!v.isEmpty()) return v;
        return env != null && !env.isEmpty() ? env : "1234";
    }

    // ================= 題庫 =================

    private static String str(JsonObject o, String k) {
        JsonElement e = o == null ? null : o.get(k);
        return e == null || e.isJsonNull() ? "" : (e.isJsonPrimitive() ? e.getAsString() : "");
    }

    private static int num(JsonObject o, String k, int dflt) {
        try {
            JsonElement e = o == null ? null : o.get(k);
            if (e == null || e.isJsonNull()) return dflt;
            return (int) Math.floor(Double.parseDouble(e.getAsString()));
        } catch (Exception ex) { return dflt; }
    }

    private static String cut(String s, int n) {
        return s.length() > n ? s.substring(0, n) : s;
    }

    static Quiz sanitize(JsonElement el) {
        Quiz qz = new Quiz();
        JsonObject d = el != null && el.isJsonObject() ? el.getAsJsonObject() : new JsonObject();
        String title = str(d, "title");
        qz.title = cut(title.isEmpty() ? "課堂小測驗" : title, 60);
        JsonElement list = d.get("questions");
        if (list != null && list.isJsonArray()) {
            JsonArray arr = list.getAsJsonArray();
            for (int i = 0; i < arr.size() && i < 200; i++) {
                JsonObject q = arr.get(i).isJsonObject() ? arr.get(i).getAsJsonObject() : new JsonObject();
                Q x = new Q();
                JsonElement ops = q.get("options");
                JsonArray oa = ops != null && ops.isJsonArray() ? ops.getAsJsonArray() : new JsonArray();
                for (int k = 0; k < 4; k++) {
                    String v = "";
                    if (k < oa.size() && oa.get(k).isJsonPrimitive()) v = oa.get(k).getAsString();
                    x.options.add(cut(v, 100));
                }
                int a = num(q, "answer", 0);
                x.answer = a >= 0 && a <= 3 ? a : 0;
                x.text = cut(str(q, "text"), 200);
                int sec = num(q, "seconds", 20);
                if (sec <= 0) sec = 20;
                x.seconds = Math.min(120, Math.max(5, sec));
                x.explanation = cut(str(q, "explanation"), 300);
                qz.questions.add(x);
            }
        }
        return qz;
    }

    private static boolean isPlayable(Q q) {
        int filled = 0;
        for (String o : q.options) if (!o.trim().isEmpty()) filled++;
        return !q.text.trim().isEmpty() && !q.options.get(q.answer).trim().isEmpty() && filled >= 2;
    }

    private static List<Q> playableOf(Quiz qz) {
        List<Q> out = new ArrayList<Q>();
        for (Q q : qz.questions) {
            if (!isPlayable(q)) continue;
            Q c = new Q();
            c.text = q.text.trim();
            for (String o : q.options) c.options.add(o.trim());
            c.answer = q.answer;
            c.seconds = q.seconds;
            c.explanation = q.explanation.trim();
            out.add(c);
        }
        return out;
    }

    private Quiz loadQuiz() {
        try (Reader r = Files.newBufferedReader(qfile, StandardCharsets.UTF_8)) {
            return sanitize(JsonParser.parseReader(r));
        } catch (Exception e) {
            LOG.warning("讀取 questions.json 失敗：" + e.getMessage());
            return new Quiz();
        }
    }

    // ================= 狀態輸出 =================

    private Q currentQ() {
        return qIndex >= 0 && qIndex < play.size() ? play.get(qIndex) : null;
    }

    private static final class Rank {
        String id, name; int score, rank, last; Integer prevRank; boolean connected;
    }

    private List<Rank> rankList() {
        List<Player> arr = new ArrayList<Player>(players.values());
        Collections.sort(arr, (a, b) -> b.score != a.score ? Integer.compare(b.score, a.score) : Long.compare(a.joinedAt, b.joinedAt));
        List<Rank> out = new ArrayList<Rank>();
        int rank = 0;
        Integer prevScore = null;
        for (int i = 0; i < arr.size(); i++) {
            Player p = arr.get(i);
            if (prevScore == null || p.score != prevScore) { rank = i + 1; prevScore = p.score; }
            Rank r = new Rank();
            r.id = p.id; r.name = p.name; r.score = p.score; r.rank = rank;
            r.prevRank = p.prevRank; r.last = p.lastPoints; r.connected = p.connected;
            out.add(r);
        }
        return out;
    }

    private int answeredCount() {
        int n = 0;
        for (Player p : players.values()) if (p.answers.containsKey(qIndex)) n++;
        return n;
    }

    private boolean allConnectedAnswered() {
        int online = 0;
        for (Player p : players.values()) {
            if (!p.connected) continue;
            online++;
            if (!p.answers.containsKey(qIndex)) return false;
        }
        return online > 0;
    }

    private int onlineCount() {
        int n = 0;
        for (Player p : players.values()) if (p.connected) n++;
        return n;
    }

    private Map<String, Object> playerState(Player p, List<Rank> ranks) {
        Q q = currentQ();
        Rank mine = null;
        for (Rank r : ranks) if (r.id.equals(p.id)) { mine = r; break; }
        Map<String, Object> s = new LinkedHashMap<String, Object>();
        s.put("title", quiz.title);
        s.put("phase", phase);
        s.put("qIndex", qIndex);
        s.put("total", play.size());
        s.put("playerCount", players.size());
        Map<String, Object> me = new LinkedHashMap<String, Object>();
        me.put("name", p.name);
        me.put("score", p.score);
        me.put("rank", mine == null ? null : mine.rank);
        me.put("prevRank", p.prevRank);
        s.put("me", me);
        if ("lobby".equals(phase)) {
            List<String> names = new ArrayList<String>();
            for (Player x : players.values()) names.add(x.name);
            s.put("names", names);
        }
        if (q != null && !"lobby".equals(phase) && !"end".equals(phase)) {
            Map<String, Object> qq = new LinkedHashMap<String, Object>();
            qq.put("text", q.text);
            qq.put("options", q.options);
            qq.put("seconds", q.seconds);
            s.put("question", qq);
        }
        if ("question".equals(phase)) {
            s.put("remainingMs", Math.max(0, endsAt - System.currentTimeMillis()));
            Answer a = p.answers.get(qIndex);
            s.put("myAnswer", a == null ? null : a.choice);
        }
        if (("reveal".equals(phase) || "leaderboard".equals(phase)) && q != null) {
            Answer a = p.answers.get(qIndex);
            Map<String, Object> res = new LinkedHashMap<String, Object>();
            res.put("choice", a == null ? null : a.choice);
            res.put("correct", a != null && a.correct);
            res.put("points", a == null ? 0 : a.points);
            s.put("result", res);
            s.put("answer", q.answer);
            s.put("explanation", q.explanation);
            s.put("counts", counts);
        }
        if (!"lobby".equals(phase)) {
            List<Map<String, Object>> lb = new ArrayList<Map<String, Object>>();
            for (Rank r : ranks) {
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                m.put("me", r.id.equals(p.id));
                m.put("name", r.name);
                m.put("score", r.score);
                m.put("rank", r.rank);
                m.put("prevRank", r.prevRank);
                m.put("last", r.last);
                lb.add(m);
            }
            s.put("leaderboard", lb);
        }
        return s;
    }

    private Map<String, Object> hostState(List<Rank> ranks) {
        Map<String, Object> s = new LinkedHashMap<String, Object>();
        s.put("title", quiz.title);
        s.put("phase", phase);
        s.put("qIndex", qIndex);
        s.put("total", play.size());
        s.put("question", currentQ());
        s.put("remainingMs", "question".equals(phase) ? Math.max(0, endsAt - System.currentTimeMillis()) : 0);
        s.put("answered", answeredCount());
        s.put("online", onlineCount());
        s.put("counts", counts);
        s.put("players", ranks);
        s.put("maxPlayers", maxPlayers);
        s.put("quiz", quiz);
        return s;
    }

    // ================= 傳送 =================

    private String evMsg(String ev, Object data) {
        JsonObject o = new JsonObject();
        o.addProperty("t", "ev");
        o.addProperty("ev", ev);
        o.add("data", gson.toJsonTree(data));
        return gson.toJson(o);
    }

    private static void send(Session s, String text) {
        if (s == null || !s.isOpen()) return;
        synchronized (s) {
            try { s.getBasicRemote().sendText(text); }
            catch (Exception ignored) { /* 連線已斷，交給 onClose 處理 */ }
        }
    }

    private void pushHost(List<Rank> ranks) {
        if (hosts.isEmpty()) return;
        String msg = evMsg("host:state", hostState(ranks == null ? rankList() : ranks));
        for (Session s : hosts.values()) send(s, msg);
    }

    private void broadcast() {
        List<Rank> ranks = rankList();
        for (Player p : players.values()) {
            if (p.connected && p.sessionId != null) send(sessions.get(p.sessionId), evMsg("state", playerState(p, ranks)));
        }
        pushHost(ranks);
    }

    // ================= 流程 =================

    private void startNext() {
        cancelTimer();
        if (qIndex + 1 >= play.size()) {
            phase = "end";
            broadcast();
            return;
        }
        // 第 1 題前大家都是 0 分並列，不比較名次升降
        boolean first = qIndex < 0;
        for (Rank r : rankList()) players.get(r.id).prevRank = first ? null : r.rank;
        qIndex++;
        Q q = currentQ();
        phase = "question";
        counts = new int[4];
        startedAt = System.currentTimeMillis();
        endsAt = startedAt + q.seconds * 1000L;
        final int idx = qIndex;
        timer = exec.schedule(() -> timeUp(idx), q.seconds * 1000L + 300, TimeUnit.MILLISECONDS);
        broadcast();
    }

    private synchronized void timeUp(int idx) {
        if (idx == qIndex) reveal();
    }

    private void cancelTimer() {
        if (timer != null) { timer.cancel(false); timer = null; }
    }

    private void reveal() {
        if (!"question".equals(phase)) return;
        cancelTimer();
        int[] c = new int[4];
        for (Player p : players.values()) {
            Answer a = p.answers.get(qIndex);
            p.lastPoints = a == null ? 0 : a.points;
            p.score += p.lastPoints;
            if (a != null) c[a.choice]++;
        }
        counts = c;
        phase = "reveal";
        broadcast();
    }

    private void resetGame(boolean keepPlayers) {
        cancelTimer();
        phase = "lobby";
        qIndex = -1;
        counts = new int[4];
        if (keepPlayers) {
            for (Player p : players.values()) {
                p.score = 0; p.answers.clear(); p.lastPoints = 0; p.prevRank = null;
            }
        } else {
            Map<String, Object> d = new HashMap<String, Object>();
            d.put("reason", "主持人已重新開始，請重新加入");
            String msg = evMsg("kicked", d);
            for (Player p : players.values()) if (p.sessionId != null) send(sessions.get(p.sessionId), msg);
            players.clear();
        }
        broadcast();
    }

    // ================= WebSocket 事件 =================

    synchronized void opened(Session s) {
        sessions.put(s.getId(), s);
    }

    synchronized void closed(Session s) {
        sessions.remove(s.getId());
        hosts.remove(s.getId());
        Object pid = s.getUserProperties().get("playerId");
        if (pid != null) {
            Player p = players.get(pid.toString());
            if (p != null && s.getId().equals(p.sessionId)) {
                p.connected = false;
                pushHost(null);
            }
        }
    }

    synchronized void onMessage(Session s, String text) {
        JsonObject m;
        try { m = JsonParser.parseString(text).getAsJsonObject(); }
        catch (Exception e) { return; }
        if (!"emit".equals(str(m, "t"))) return;
        String ev = str(m, "ev");
        JsonElement data = m.get("data");
        JsonObject d = data != null && data.isJsonObject() ? data.getAsJsonObject() : new JsonObject();
        Object reply = handle(s, ev, d, data);
        JsonElement id = m.get("id");
        if (id != null && !id.isJsonNull()) {
            JsonObject a = new JsonObject();
            a.addProperty("t", "ack");
            a.add("id", id);
            a.add("data", gson.toJsonTree(reply == null ? new HashMap<String, Object>() : reply));
            send(s, gson.toJson(a));
        }
    }

    private static Map<String, Object> ok(boolean ok) {
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        r.put("ok", ok);
        return r;
    }

    private static Map<String, Object> err(String msg) {
        Map<String, Object> r = ok(false);
        r.put("error", msg);
        return r;
    }

    private boolean isHost(Session s) {
        return Boolean.TRUE.equals(s.getUserProperties().get("isHost"));
    }

    private Object handle(Session s, String ev, JsonObject d, JsonElement raw) {
        if ("player:join".equals(ev)) return join(s, d);
        if ("player:answer".equals(ev)) { answer(s, d); return null; }
        if ("host:auth".equals(ev)) {
            if (!hostPin().equals(str(d, "pin"))) return ok(false);
            s.getUserProperties().put("isHost", Boolean.TRUE);
            hosts.put(s.getId(), s);
            Map<String, Object> r = ok(true);
            pushHostLater();
            return r;
        }
        if (!isHost(s)) return null;
        switch (ev) {
            case "host:next":
                if (!"question".equals(phase)) startNext();
                return null;
            case "host:reveal":
                reveal();
                return null;
            case "host:leaderboard":
                if ("reveal".equals(phase)) { phase = "leaderboard"; broadcast(); }
                return null;
            case "host:end":
                cancelTimer(); phase = "end"; broadcast();
                return null;
            case "host:reset":
                resetGame(d.has("keepPlayers") && d.get("keepPlayers").isJsonPrimitive() && d.get("keepPlayers").getAsBoolean());
                return null;
            case "host:kick": {
                Player p = players.get(str(d, "id"));
                if (p == null) return null;
                Map<String, Object> k = new HashMap<String, Object>();
                k.put("reason", "你已被主持人移出，可以重新加入");
                if (p.sessionId != null) send(sessions.get(p.sessionId), evMsg("kicked", k));
                players.remove(p.id);
                broadcast();
                return null;
            }
            case "host:saveQuiz": {
                if (!"lobby".equals(phase) && !"end".equals(phase)) return err("測驗進行中不能存檔，請先回到大廳");
                Quiz next = sanitize(raw);
                try {
                    Path tmp = qfile.resolveSibling("questions.json.tmp");
                    try (Writer w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
                        new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create().toJson(next, w);
                    }
                    Files.move(tmp, qfile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (Exception e) {
                    return err("寫入檔案失敗：" + e.getMessage());
                }
                quiz = next;
                play = playableOf(quiz);
                Map<String, Object> r = ok(true);
                r.put("count", quiz.questions.size());
                r.put("playable", play.size());
                broadcast();
                return r;
            }
            default:
                return null;
        }
    }

    /** 先回覆 ack（讓主持頁完成登入），再送狀態。 */
    private void pushHostLater() {
        exec.execute(() -> { synchronized (Game.this) { pushHost(null); } });
    }

    private Object join(Session s, JsonObject d) {
        String id = str(d, "id");
        String name = cut(str(d, "name").trim().replaceAll("\\s+", " "), 16);
        Player p = id.isEmpty() ? null : players.get(id);
        if (p == null) {
            if (name.isEmpty()) { Map<String, Object> r = ok(false); r.put("notFound", !id.isEmpty()); return r; }
            if (players.size() >= maxPlayers) return err("人數已滿（上限 " + maxPlayers + " 人）");
            for (Player x : players.values()) if (x.name.equals(name)) return err("這個暱稱已經有人用了，換一個吧");
            p = new Player();
            p.id = UUID.randomUUID().toString();
            p.name = name;
            p.joinedAt = System.currentTimeMillis();
            players.put(p.id, p);
        }
        p.sessionId = s.getId();
        p.connected = true;
        s.getUserProperties().put("playerId", p.id);
        Map<String, Object> r = ok(true);
        r.put("id", p.id);
        exec.execute(() -> { synchronized (Game.this) { broadcast(); } });
        return r;
    }

    private void answer(Session s, JsonObject d) {
        Object pid = s.getUserProperties().get("playerId");
        Player p = pid == null ? null : players.get(pid.toString());
        Q q = currentQ();
        if (p == null || q == null || !"question".equals(phase) || p.answers.containsKey(qIndex)) return;
        int choice = num(d, "choice", -1);
        if (choice < 0 || choice > 3 || q.options.get(choice).isEmpty()) return;
        long limit = q.seconds * 1000L;
        long elapsed = Math.min(limit, Math.max(0, System.currentTimeMillis() - startedAt));
        Answer a = new Answer();
        a.choice = choice;
        a.correct = choice == q.answer;
        a.points = a.correct ? (int) Math.round(1000 * (1 - ((double) elapsed / limit) / 2)) : 0; // 答對 500–1000 分，越快越高
        a.ms = elapsed;
        p.answers.put(qIndex, a);
        Map<String, Object> ans = new HashMap<String, Object>();
        ans.put("choice", choice);
        send(s, evMsg("answered", ans));
        if (allConnectedAnswered()) reveal();
        else pushHost(null);
    }

    // ================= 工具 =================

    static List<String> lanAddresses() {
        List<String> out = new ArrayList<String>();
        try {
            Enumeration<NetworkInterface> ifs = NetworkInterface.getNetworkInterfaces();
            while (ifs != null && ifs.hasMoreElements()) {
                NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> as = ni.getInetAddresses();
                while (as.hasMoreElements()) {
                    InetAddress a = as.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    /** 題庫與設定放在 Tomcat 的 webapps 之外，重新部署 WAR 也不會被覆蓋。 */
    static Path defaultDataDir(String contextName) {
        String v = System.getProperty("quiz.data.dir");
        if (v == null || v.isEmpty()) v = System.getenv("QUIZ_DATA_DIR");
        if (v != null && !v.isEmpty()) return Paths.get(v);
        String base = System.getProperty("catalina.base");
        if (base == null || base.isEmpty()) base = System.getProperty("user.dir");
        String name = contextName == null || contextName.isEmpty() ? "ROOT" : contextName.replaceAll("[^A-Za-z0-9._-]", "_");
        return Paths.get(base, "quiz-data", name);
    }
}
