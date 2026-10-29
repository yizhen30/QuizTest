package tw.quiz;

import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/** /info：主持頁用來產生區網 QR Code；/host：主持頁的短網址。 */
@WebServlet(urlPatterns = {"/info", "/host"})
public class InfoServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse res) throws ServletException, IOException {
        if ("/host".equals(req.getServletPath())) {
            req.getRequestDispatcher("/host.html").forward(req, res);
            return;
        }
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("port", req.getServerPort());
        m.put("lan", Game.lanAddresses());
        res.setContentType("application/json;charset=UTF-8");
        res.setHeader("Cache-Control", "no-store");
        res.getWriter().write(Game.I.gson.toJson(m));
    }
}
