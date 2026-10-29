/*
 * 極簡即時連線（取代 socket.io，直接用瀏覽器內建的 WebSocket）
 * 用法和 socket.io 相同：var socket = io(); socket.on(ev, fn); socket.emit(ev, data, ack)
 */
(function () {
  'use strict';
  window.io = function () {
    var handlers = {};
    var acks = {};
    var seq = 0;
    var queue = [];
    var ws = null;
    var retry = 0;
    var pingTimer = 0;
    var url = new URL('ws', document.baseURI);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    function fire(ev, data) {
      (handlers[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
    }

    function connect() {
      try { ws = new WebSocket(url.href); } catch (e) { schedule(); return; }
      ws.onopen = function () {
        retry = 0;
        var q = queue; queue = [];
        q.forEach(function (m) { ws.send(m); });
        clearInterval(pingTimer);
        pingTimer = setInterval(function () { if (ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, 25000);
        fire('connect');
      };
      ws.onmessage = function (e) {
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'ack') {
          var fn = acks[m.id];
          delete acks[m.id];
          if (fn) fn(m.data);
        } else if (m.t === 'ev') {
          fire(m.ev, m.data);
        }
      };
      ws.onclose = function () {
        clearInterval(pingTimer);
        var was = ws; ws = null;
        if (was) fire('disconnect');
        schedule();
      };
      ws.onerror = function () { /* onclose 會接著處理 */ };
    }

    function schedule() {
      var wait = Math.min(5000, 500 * Math.pow(2, retry++));
      setTimeout(connect, wait);
    }

    var api = {
      on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return api; },
      emit: function (ev, data, ack) {
        var m = { t: 'emit', ev: ev, data: data === undefined ? {} : data };
        if (typeof ack === 'function') { m.id = ++seq; acks[m.id] = ack; }
        var text = JSON.stringify(m);
        if (ws && ws.readyState === 1) ws.send(text);
        else queue.push(text);
        return api;
      },
    };

    // 手機從背景切回來時，如果連線已斷，立刻重連
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) { retry = 0; }
    });

    setTimeout(connect, 0);
    return api;
  };
})();
