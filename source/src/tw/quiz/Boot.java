package tw.quiz;

import javax.servlet.ServletContext;
import javax.servlet.ServletContextEvent;
import javax.servlet.ServletContextListener;
import javax.servlet.annotation.WebListener;
import java.io.InputStream;
import java.nio.file.Path;

@WebListener
public class Boot implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent e) {
        ServletContext ctx = e.getServletContext();
        String name = ctx.getContextPath().replaceFirst("^/", "");
        Path dir = Game.defaultDataDir(name);
        try (InputStream def = ctx.getResourceAsStream("/WEB-INF/default-questions.json")) {
            Game.I.init(dir, def);
            ctx.log("課堂即時問答：主持頁 " + (ctx.getContextPath().isEmpty() ? "" : ctx.getContextPath()) + "/host ，題庫與密碼設定在 " + Game.I.dataDirText());
        } catch (Exception ex) {
            ctx.log("課堂即時問答啟動失敗", ex);
            throw new IllegalStateException(ex);
        }
    }

    @Override
    public void contextDestroyed(ServletContextEvent e) {
        Game.I.shutdown();
    }
}
